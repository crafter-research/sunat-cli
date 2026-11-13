/**
 * Read path over SOL's "Consulta de declaraciones juradas y pagos".
 *
 * Why the browser: the visor is a JSP servlet on `ww1.sunat.gob.pe` whose
 * session cookie is minted only by the menu hop
 * (`MenuInternet.htm?action=execute&code=12.1.1.1.4&s=ww1`). Opening the
 * servlet URL cold answers 200 with the login page. Measured 2026-08-27: the
 * same fetches that work after the hop return an empty table without it.
 *
 * Once the hop happened, the servlet is plain form POSTs answered with HTML:
 *
 *   POST cdpS01Alias  accion=lista&fechaDesde=DD/MM/YYYY&fechaHasta=DD/MM/YYYY
 *                     (+ num_pres, cod_for, num_ord, empty)   → results table
 *   POST cdpS01Alias  accion=validar_constanciaNP&num_ord=…&cod_for=0601
 *                     → <codigo>{GUID}</codigo>  ("0" = not rendered yet)
 *   GET  cdpS01Alias?accion=obtener_constanciaNP&cod_ecm={GUID}
 *                     → application/pdf (~45 KB)
 *
 * Every request here is one the visor itself makes when an operator clicks
 * "Buscar", a page link or "Comprobante". Nothing in this module files, pays or amends.
 * The form's own `cod_for`/`num_ord` filters are sent empty and filtering is
 * done client-side: their server-side behavior was not exercised.
 */

import { ensureSOLSession, SOL_MENU_URL } from "../browser/auth.ts";
import { type CdpSession, connect } from "../browser/cdp.ts";
import * as browser from "../browser/client.ts";
import { getCredentials } from "../data/config.ts";
import {
	hasNoResultsNotice,
	type ListaPagination,
	looksLikeLostSession,
	parseListaHtml,
	parseListaPagination,
} from "./parse.ts";
import type { DeclaracionRow } from "./types.ts";

export const SERVLET_PATH = "/cl-ti-itdeclpagcon-mepeco/cdpS01Alias";
/** SOL menu leaf "Consulta de declaraciones juradas y pagos". */
export const MENU_CODE = "12.1.1.1.4";
const MENU_LI_ID = "nivel4_12_1_1_1_4";
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * Same pacing as the buzón visor: SUNAT's legacy hosts throttle by IP and
 * answer with a static error page for a minute or two when hammered.
 */
const MIN_REQUEST_GAP_MS = 1200;

export class DeclaracionesPortalError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
		readonly hint?: string,
	) {
		super(message);
		this.name = "DeclaracionesPortalError";
	}
}

/** Body of `accion=lista`, exactly the fields the visor's own form submits. */
export function buildListaBody(desde: string, hasta: string): string {
	const p = new URLSearchParams();
	p.set("accion", "lista");
	p.set("num_pres", "");
	p.set("cod_for", "");
	p.set("num_ord", "");
	p.set("fechaDesde", desde);
	p.set("fechaHasta", hasta);
	p.set("B1", "Buscar");
	return p.toString();
}

/**
 * Runs inside the ww1 page so the servlet sees the session cookie. Returns
 * JSON text: `{ok, status, html}`. Cookies are never read, only sent by the
 * browser through `credentials: 'include'`.
 */
export function buildListaExpression(desde: string, hasta: string, pagination?: ListaPagination): string {
	const params = new URLSearchParams(buildListaBody(desde, hasta));
	if (pagination) {
		params.delete("accion");
		params.delete("B1");
		params.set("pagina", String(pagination.pagina));
		params.set("tamanioPagina", String(pagination.tamanioPagina));
	}
	const path = pagination ? "/cl-ti-itdeclpagcon-mepeco/ConsultaDeclaracion.jsp" : SERVLET_PATH;
	const body = JSON.stringify(params.toString());
	return `(async()=>{try{const r=await fetch(${JSON.stringify(path)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:${body},signal:AbortSignal.timeout(${REQUEST_TIMEOUT_MS})});const html=await r.text();return JSON.stringify({ok:r.ok,status:r.status,html})}catch(e){return JSON.stringify({ok:false,status:0,html:''})}})()`;
}

/**
 * Two hops in one evaluation: validate (gets the ECM GUID) then download. The
 * PDF comes back base64 because CDP `returnByValue` only carries JSON.
 */
export function buildConstanciaExpression(numOrden: string, formulario: string): string {
	const body = JSON.stringify(`accion=validar_constanciaNP&num_ord=${numOrden}&cod_for=${formulario}`);
	return `(async()=>{try{const v=await fetch(${JSON.stringify(SERVLET_PATH)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:${body},signal:AbortSignal.timeout(${REQUEST_TIMEOUT_MS})});const xml=await v.text();const m=xml.match(/<codigo>\\s*([^<]+?)\\s*<\\/codigo>/i);if(!m)return JSON.stringify({ok:false,status:v.status,code:'no-codigo',xml:xml.slice(0,200)});if(m[1]==='0')return JSON.stringify({ok:false,status:200,code:'not-available'});const p=await fetch(${JSON.stringify(SERVLET_PATH)}+'?accion=obtener_constanciaNP&cod_ecm='+encodeURIComponent(m[1]),{credentials:'include',signal:AbortSignal.timeout(${REQUEST_TIMEOUT_MS})});const buf=new Uint8Array(await p.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return JSON.stringify({ok:p.ok,status:p.status,contentType:p.headers.get('content-type'),base64:btoa(s)})}catch(e){return JSON.stringify({ok:false,status:0,code:'network'})}})()`;
}

function parseEvalValue<T>(value: unknown): T {
	if (typeof value !== "string") {
		throw new DeclaracionesPortalError("SUNAT returned an invalid response.", 502, "bad-response");
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new DeclaracionesPortalError("SUNAT returned an invalid response.", 502, "bad-response");
	}
}

export function createDeclaracionesRequester<TSession extends Pick<CdpSession, "evalIn">>(
	session: TSession,
	dependencies: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
) {
	const sleep = dependencies.sleep ?? browser.sleep;
	const now = dependencies.now ?? Date.now;
	let queue: Promise<unknown> = Promise.resolve();
	let lastRequestAt = 0;

	return async <T>(expression: string): Promise<T> => {
		const run = queue.then(async () => {
			const wait = lastRequestAt + MIN_REQUEST_GAP_MS - now();
			if (wait > 0) await sleep(wait);
			try {
				const result = await session.evalIn(expression);
				if (result.err) throw new DeclaracionesPortalError(`SUNAT request failed: ${result.err}`, 502, "eval-failed");
				return parseEvalValue<T>(result.val);
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

async function resetToMenu(): Promise<void> {
	await browser.evalJS(`location.assign(${JSON.stringify(SOL_MENU_URL)})`);
	await browser.sleep(1800);
}

/**
 * Click the menu leaf by its stable DOM id (`nivel4_12_1_1_1_4`), falling back
 * to a label match. The menu tree does not nest `<li>` under the group, so the
 * id is the reliable handle; labels are the fallback if SUNAT renumbers.
 */
const CLICK_MENU_LEAF = `(function(){var li=document.getElementById(${JSON.stringify(MENU_LI_ID)});if(!li){li=[...document.querySelectorAll('li')].find(function(e){return /Consulta de declaraciones juradas y pagos/i.test(e.innerText||'')})}if(!li)return 'missing';(li.querySelector('a')||li).click();return 'clicked'})()`;

async function openVisorFrame(): Promise<CdpSession> {
	await ensureSOLSession(getCredentials());
	await resetToMenu();
	let clicked = await browser.evalJS(CLICK_MENU_LEAF);
	if (!clicked.includes("clicked")) {
		await ensureSOLSession(getCredentials());
		await resetToMenu();
		clicked = await browser.evalJS(CLICK_MENU_LEAF);
	}
	if (!clicked.includes("clicked")) {
		throw new DeclaracionesPortalError(
			"The 'Consulta de declaraciones juradas y pagos' entry was not found in the authenticated menu.",
			401,
			"menu-entry-missing",
			"Run 'sunat-cli login' and retry.",
		);
	}
	// The menu loads the servlet into iframeApplication; give the hop time to
	// set the ww1 session before attaching to that frame's context.
	await browser.sleep(4000);
	return connect({
		pageUrl: "MenuInternet.htm",
		origin: "ww1.sunat.gob.pe",
		probe: `location.pathname.includes('/cl-ti-itdeclpagcon-mepeco/')`,
	});
}

export interface DeclaracionesPortal {
	lista: (desde: string, hasta: string) => Promise<DeclaracionRow[]>;
	constancia: (numOrden: string, formulario: string) => Promise<Uint8Array>;
	close: () => Promise<void>;
}

type ListaResponse = { ok: boolean; status: number; html: string };
type ConstanciaResponse = {
	ok: boolean;
	status: number;
	code?: string;
	contentType?: string | null;
	base64?: string;
};

export async function collectDeclaraciones(
	desde: string,
	hasta: string,
	request: (expression: string) => Promise<ListaResponse>,
): Promise<DeclaracionRow[]> {
	const items: DeclaracionRow[] = [];
	const seen = new Set<string>();
	let pagination: ListaPagination | undefined;
	for (let page = 1; page <= 100; page++) {
		const res = await request(buildListaExpression(desde, hasta, pagination));
		if (!res.ok) {
			throw new DeclaracionesPortalError(
				res.status === 0 ? "SUNAT did not answer." : `SUNAT answered HTTP ${res.status}.`,
				res.status || 503,
				res.status === 0 ? "network" : "http-error",
				"Retry in a minute; the legacy hosts throttle by IP.",
			);
		}
		if (looksLikeLostSession(res.html)) {
			throw new DeclaracionesPortalError(
				"The SOL session expired before the query.",
				401,
				"session-expired",
				"Run 'sunat-cli login' and retry.",
			);
		}
		const rows = parseListaHtml(res.html);
		if (rows.length === 0) {
			if (hasNoResultsNotice(res.html)) return items;
			throw new DeclaracionesPortalError(
				"SUNAT returned a page without a results table.",
				502,
				"unexpected-page",
				"The visor layout may have changed. Run with the browser visible to inspect.",
			);
		}
		const before = items.length;
		for (const row of rows) {
			const key = JSON.stringify([row.kind, row.formulario, row.numOrden, row.numPresentacion]);
			if (seen.has(key)) continue;
			seen.add(key);
			items.push(row);
		}
		if (page > 1 && items.length === before) {
			throw new DeclaracionesPortalError(
				"SUNAT repeated declaration results; the listing is incomplete.",
				502,
				"pagination-stalled",
			);
		}
		let current: ListaPagination | null;
		try {
			current = parseListaPagination(res.html);
			if (!current && pagination && rows.length >= pagination.tamanioPagina) {
				throw new Error("Missing pagination state");
			}
			if (current && (current.pagina !== page || (pagination && current.tamanioPagina !== pagination.tamanioPagina))) {
				throw new Error("Unexpected pagination state");
			}
		} catch {
			throw new DeclaracionesPortalError(
				"SUNAT returned inconsistent pagination; the listing is incomplete.",
				502,
				"invalid-pagination",
			);
		}
		if (!current || rows.length < current.tamanioPagina) return items;
		pagination = { ...current, pagina: page + 1 };
	}
	throw new DeclaracionesPortalError(
		"The declaration query exceeded 100 pages; the listing is incomplete.",
		502,
		"pagination-limit",
		"Retry with a narrower date range.",
	);
}

export async function openDeclaracionesPortal(): Promise<DeclaracionesPortal> {
	let session: CdpSession;
	try {
		session = await openVisorFrame();
	} catch (error) {
		await browser.close();
		if (error instanceof DeclaracionesPortalError) throw error;
		throw new DeclaracionesPortalError(
			"Could not open the declarations visor.",
			503,
			"portal-unavailable",
			"Run 'sunat-cli login' and retry. SUNAT portals can be temporarily unavailable.",
		);
	}

	let closed = false;
	const request = createDeclaracionesRequester(session);

	return {
		lista: (desde, hasta) => collectDeclaraciones(desde, hasta, request),
		constancia: async (numOrden, formulario) => {
			const res = await request<ConstanciaResponse>(buildConstanciaExpression(numOrden, formulario));
			if (res.code === "not-available") {
				throw new DeclaracionesPortalError(
					"SUNAT has not rendered this constancia yet.",
					409,
					"not-available",
					"SUNAT's own message is 'vuelva a intentarlo en otro momento'. Retry later.",
				);
			}
			if (res.code === "no-codigo") {
				throw new DeclaracionesPortalError(
					"SUNAT did not return a constancia code for this número de orden.",
					404,
					"not-found",
					"Check numOrden and --formulario against 'sunat-cli declaraciones list'. Annual returns (0709/0710) use a different servlet and are not supported yet.",
				);
			}
			if (!res.ok || !res.base64) {
				throw new DeclaracionesPortalError(
					res.status === 0 ? "SUNAT did not answer." : `SUNAT answered HTTP ${res.status}.`,
					res.status || 503,
					res.status === 0 ? "network" : "http-error",
				);
			}
			if (!(res.contentType ?? "").includes("pdf")) {
				throw new DeclaracionesPortalError(
					"SUNAT answered with something other than a PDF.",
					502,
					"not-pdf",
					"Usually the session expired mid-download. Run 'sunat-cli login' and retry.",
				);
			}
			return Uint8Array.from(Buffer.from(res.base64, "base64"));
		},
		close: async () => {
			if (closed) return;
			closed = true;
			session.close();
			await browser.close();
		},
	};
}
