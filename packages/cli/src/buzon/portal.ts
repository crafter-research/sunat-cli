import { ensureSOLSession, SOL_MENU_URL } from "../browser/auth.ts";
import { type CdpSession, connect } from "../browser/cdp.ts";
import * as browser from "../browser/client.ts";
import { getCredentials } from "../data/config.ts";
import { normalizeBuzonPages, pageEnd, pageRows } from "./normalize.ts";
import type { BuzonKind, BuzonOverview, RawBuzonPage } from "./types.ts";

const DETAIL_PATH = "/ol-ti-itvisornoti/visor/obtenerDetalleNotiMen";
const DETAIL_ROUTE = `**${DETAIL_PATH}*`;
const LIST_PATH = "/ol-ti-itvisornoti/visor/listNotiMenPag";
const FOLDERS_PATH = "/ol-ti-itvisornoti/visor/ajax/listarCarpetas";
const ALERTS_PATH = "/ol-ti-itvisornoti/visor/consultarAlertas";
const MIN_REQUEST_GAP_MS = 1200;
const REQUEST_TIMEOUT_MS = 15_000;

export class BuzonPortalError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
		readonly hint?: string,
	) {
		super(message);
		this.name = "BuzonPortalError";
	}
}

export type BuzonPageFetcher = (kind: BuzonKind, page: number) => Promise<RawBuzonPage>;
export type BuzonRequestOptions = { method?: "GET" | "POST"; query?: Record<string, string> };

function tipoMsj(kind: BuzonKind): string {
	return kind === "message" ? "1" : "2";
}

function parseEvalValue<T>(value: unknown): T {
	if (typeof value !== "string") throw new BuzonPortalError("SUNAT returned an invalid response.", 502, "bad-response");
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new BuzonPortalError("SUNAT returned an invalid response.", 502, "bad-response");
	}
}

export function buildBuzonRequestExpression(path: string, options: BuzonRequestOptions = {}): string {
	const method = options.method ?? "GET";
	return `(async()=>{const u=new URL(${JSON.stringify(path)},location.origin);for(const [k,v] of Object.entries(${JSON.stringify(options.query ?? {})}))u.searchParams.set(k,v);try{const r=await fetch(u,{method:${JSON.stringify(method)},credentials:'include',headers:{accept:'application/json'},signal:AbortSignal.timeout(${REQUEST_TIMEOUT_MS})});let d=null;try{d=await r.json()}catch{}return JSON.stringify({ok:r.ok,status:r.status,data:d})}catch{return JSON.stringify({ok:false,status:0,data:null})}})()`;
}

export function createBuzonRequester<TSession extends Pick<CdpSession, "evalIn">>(
	session: TSession,
	dependencies: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
) {
	const sleep = dependencies.sleep ?? browser.sleep;
	const now = dependencies.now ?? Date.now;
	let queue: Promise<unknown> = Promise.resolve();
	let lastRequestAt = 0;

	return async <T>(path: string, options: BuzonRequestOptions = {}): Promise<T> => {
		const run = queue.then(async () => {
			const wait = lastRequestAt + MIN_REQUEST_GAP_MS - now();
			if (wait > 0) await sleep(wait);
			try {
				for (let attempt = 0; attempt < 3; attempt++) {
					const evaluated = await session.evalIn(buildBuzonRequestExpression(path, options));
					if (evaluated.err) throw new BuzonPortalError("SUNAT rejected the metadata request.", 502, "bad-response");
					const envelope = parseEvalValue<{ ok: boolean; status: number; data: T | null }>(evaluated.val);
					if (envelope.ok && envelope.data !== null) return envelope.data;
					const retryable = envelope.status === 0 || envelope.status === 429 || envelope.status >= 500;
					if (retryable && attempt < 2) {
						await sleep(2000 * (attempt + 1));
						continue;
					}
					throw new BuzonPortalError(
						"SUNAT refused the Buzón metadata request.",
						envelope.status || 502,
						retryable ? "throttled" : "request-failed",
						retryable ? "Wait a minute and retry. Requests are serialized automatically." : undefined,
					);
				}
				throw new BuzonPortalError("SUNAT refused the Buzón metadata request.", 502, "request-failed");
			} finally {
				lastRequestAt = now();
			}
		});
		queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run as Promise<T>;
	};
}

async function collectKind(kind: BuzonKind, maxPages: number, fetchPage: BuzonPageFetcher) {
	const pages: RawBuzonPage[] = [];
	for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
		const page = await fetchPage(kind, pageNumber);
		pages.push(page);
		const rows = pageRows(page);
		const endPage = pageEnd(page);
		if (rows.length === 0 || (endPage !== null && pageNumber >= endPage)) break;
	}
	return normalizeBuzonPages(kind, pages);
}

export async function collectBuzon(maxPages: number, fetchPage: BuzonPageFetcher) {
	const messages = await collectKind("message", maxPages, fetchPage);
	const notifications = await collectKind("notification", maxPages, fetchPage);
	return {
		items: [...messages.items, ...notifications.items],
		summaries: [messages.summary, notifications.summary],
	};
}

function findBuzonRef(snapshot: string): string | null {
	for (const line of snapshot.split("\n")) {
		if (!/link .*Buz[oó]n Electr[oó]nico/i.test(line)) continue;
		const match = line.match(/ref=(e\d+)/);
		if (match) return `@${match[1]}`;
	}
	return null;
}

async function resetToMenu(): Promise<string> {
	await browser.evalJS(`location.assign(${JSON.stringify(SOL_MENU_URL)})`);
	await browser.sleep(1800);
	return browser.snapshot({ interactive: true });
}

async function openBuzonFrame(): Promise<CdpSession> {
	await ensureSOLSession(getCredentials());
	let snapshot = await resetToMenu();
	if (!/Buz[oó]n Electr[oó]nico/i.test(snapshot)) {
		await ensureSOLSession(getCredentials());
		snapshot = await browser.snapshot({ interactive: true });
	}
	const ref = findBuzonRef(snapshot);
	if (!ref) {
		throw new BuzonPortalError(
			"The Buzón SOL entry was not found in the authenticated menu.",
			401,
			"buzon-entry-missing",
			"Run 'sunat-cli login' and retry.",
		);
	}
	await browser.routeAbort(DETAIL_ROUTE);
	await browser.click(ref);
	await browser.sleep(1200);
	return connect({
		pageUrl: "MenuInternet.htm",
		origin: "ww1.sunat.gob.pe",
		probe: `location.pathname.includes('/ol-ti-itvisornoti/visor/')`,
	});
}

export interface BuzonPortal {
	fetchPage: BuzonPageFetcher;
	fetchOverview: () => Promise<BuzonOverview>;
	close: () => Promise<void>;
}

export async function openBuzonPortal(): Promise<BuzonPortal> {
	let session: CdpSession;
	try {
		session = await openBuzonFrame();
	} catch (error) {
		await browser.close();
		await browser.unroute(DETAIL_ROUTE).catch(() => {});
		if (error instanceof BuzonPortalError) throw error;
		throw new BuzonPortalError(
			"Could not open the Buzón SOL metadata reader.",
			503,
			"portal-unavailable",
			"Run 'sunat-cli login' and retry. SUNAT portals can be temporarily unavailable.",
		);
	}

	let closed = false;
	const request = createBuzonRequester(session);

	return {
		fetchPage: (kind, page) =>
			request<RawBuzonPage>(LIST_PATH, {
				query: {
					tipoMsj: tipoMsj(kind),
					codCarpeta: "00",
					codEtiqueta: "",
					page: String(page),
					des_asunto: "",
					codMensaje: "",
					tipoOrden: "NADA",
				},
			}),
		fetchOverview: async () => {
			const folders = await request<unknown>(FOLDERS_PATH);
			const alerts = await request<{ listaAlertas?: unknown }>(ALERTS_PATH, { method: "POST" });
			return {
				foldersObserved: Array.isArray(folders) ? folders.length : 0,
				alertsObserved: Array.isArray(alerts?.listaAlertas) ? alerts.listaAlertas.length : 0,
			};
		},
		close: async () => {
			if (closed) return;
			closed = true;
			session.close();
			await browser.close();
			await browser.unroute(DETAIL_ROUTE).catch(() => {});
		},
	};
}
