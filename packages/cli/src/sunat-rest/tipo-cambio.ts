/**
 * Tipo de Cambio SUNAT — daily official rate.
 *
 * SUNAT's TC page (https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias)
 * renders a calendar whose data comes from a JSON endpoint:
 *
 *   POST /cl-at-ittipcam/tcS01Alias/listarTipoCambio
 *   body: {"anio": 2025, "mes": 10, "token": "..."}
 *   -> [{"fecPublica":"01/11/2025","valTipo":"3.372","codTipo":"C"}, ...]
 *
 * Notes on the contract, measured 2026-08-22:
 *  - `mes` is ZERO-INDEXED (JS getMonth()): mes=10 returns November.
 *  - `codTipo` is "C" (compra) or "V" (venta). Each date yields two rows.
 *  - `token` is a reCAPTCHA v3 token in the browser, but the endpoint does
 *    not reject requests carrying a dummy value.
 *  - The WAF rejects requests without browser-like headers. A plain
 *    User-Agent swap is not enough; Referer and Origin are required.
 *
 * Cache: by ISO date at ~/.sunat/cache/tipo-cambio.jsonl (one line per date).
 * SUNAT publishes once per business day; a date with no published rate
 * (weekend/feriado) resolves to the previous business day's rate, which is
 * the legally valid TC for that date.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../data/config.ts";

export interface TipoCambioRate {
	fecha: string; // YYYY-MM-DD — the date the rate applies to
	compra: number; // S/ per USD (compra)
	venta: number; // S/ per USD (venta)
	moneda: "USD"; // SUNAT only publishes USD/PEN officially
	source: "sunat";
	fetchedAt: string; // ISO timestamp when we fetched
	publicada?: string; // YYYY-MM-DD actually published (differs on weekends/feriados)
}

interface TcRow {
	fecPublica: string; // DD/MM/YYYY
	valTipo: string;
	codTipo: "C" | "V";
}

const CACHE_FILE = join(paths.sunatDir, "cache", "tipo-cambio.jsonl");
const BASE = "https://e-consulta.sunat.gob.pe/cl-at-ittipcam";
const TC_PAGE = `${BASE}/tcS01Alias`;
const TC_ENDPOINT = `${BASE}/tcS01Alias/listarTipoCambio`;

const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	Accept: "application/json, text/javascript, */*; q=0.01",
	"Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
	"Content-Type": "application/json; charset=utf-8",
	"X-Requested-With": "XMLHttpRequest",
	Referer: TC_PAGE,
	Origin: "https://e-consulta.sunat.gob.pe",
	"Sec-Fetch-Dest": "empty",
	"Sec-Fetch-Mode": "cors",
	"Sec-Fetch-Site": "same-origin",
};

function ensureCacheDir(): void {
	const dir = join(paths.sunatDir, "cache");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadCachedTc(fecha: string): TipoCambioRate | null {
	if (!existsSync(CACHE_FILE)) return null;
	const lines = readFileSync(CACHE_FILE, "utf-8").split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as TipoCambioRate;
			if (entry.fecha === fecha) return entry;
		} catch {
			// skip malformed line
		}
	}
	return null;
}

export function saveTc(rate: TipoCambioRate): void {
	ensureCacheDir();
	// dedupe: rewrite without any prior entry for the same fecha
	const existing = existsSync(CACHE_FILE)
		? readFileSync(CACHE_FILE, "utf-8")
				.split("\n")
				.filter((l) => l.trim().length > 0)
				.map((l) => {
					try {
						return JSON.parse(l) as TipoCambioRate;
					} catch {
						return null;
					}
				})
				.filter((e): e is TipoCambioRate => e !== null && e.fecha !== rate.fecha)
		: [];
	existing.push(rate);
	const text = existing.map((e) => JSON.stringify(e)).join("\n");
	writeFileSync(CACHE_FILE, `${text}\n`);
}

function toIso(fecPublica: string): string {
	const [d, m, y] = fecPublica.split("/");
	return `${y}-${m}-${d}`;
}

/**
 * Pick the rate for `fechaIso` from a month's rows. SUNAT does not publish on
 * weekends or holidays; for those dates the valid TC is the last one published
 * on or before the requested date, so we fall back to it rather than failing.
 */
export function selectRateForDate(
	rows: TcRow[],
	fechaIso: string,
): { compra: number; venta: number; publicada: string } | null {
	const byDate = new Map<string, { compra?: number; venta?: number }>();
	for (const r of rows) {
		const iso = toIso(r.fecPublica);
		const entry = byDate.get(iso) || {};
		if (r.codTipo === "C") entry.compra = Number.parseFloat(r.valTipo);
		if (r.codTipo === "V") entry.venta = Number.parseFloat(r.valTipo);
		byDate.set(iso, entry);
	}
	const candidates = [...byDate.keys()].filter((d) => d <= fechaIso).sort();
	const chosen = candidates[candidates.length - 1];
	if (!chosen) return null;
	const v = byDate.get(chosen);
	if (v?.compra === undefined || v?.venta === undefined) return null;
	return { compra: v.compra, venta: v.venta, publicada: chosen };
}

async function fetchMonth(anio: number, mesIndex: number): Promise<TcRow[]> {
	const res = await fetch(TC_ENDPOINT, {
		method: "POST",
		headers: BROWSER_HEADERS,
		// A non-empty token is required; its contents are not validated.
		body: JSON.stringify({ anio, mes: mesIndex, token: "x" }),
	});
	if (!res.ok) {
		throw new Error(
			`SUNAT TC endpoint returned HTTP ${res.status} for ${anio}-${String(mesIndex + 1).padStart(2, "0")}`,
		);
	}
	const text = await res.text();
	if (text.includes("Request Rejected")) {
		throw new Error("SUNAT WAF rejected the request. Headers may need updating.");
	}
	const rows = JSON.parse(text) as TcRow[];
	// An empty array here is not "no rates published": SUNAT answers 200 with
	// [] whenever `token` is empty, so treat it as a contract violation rather
	// than as data. Every real month has rows.
	if (rows.length === 0) {
		throw new Error(
			`SUNAT returned no rows for ${anio}-${String(mesIndex + 1).padStart(2, "0")}. ` +
				"This usually means the request was rejected rather than that no rate exists.",
		);
	}
	return rows;
}

export interface FetchTcOpts {
	fecha?: string; // YYYY-MM-DD; defaults to today
	force?: boolean; // bypass cache
}

/**
 * Public entry point. Returns cached if present (always cacheable, since
 * SUNAT publishes immutable historical TCs). Otherwise queries the month's
 * endpoint, picks the row for the requested date, caches, returns.
 */
export async function getTipoCambio(opts: FetchTcOpts = {}): Promise<TipoCambioRate> {
	const fecha = opts.fecha || new Date().toISOString().split("T")[0];

	if (!opts.force) {
		const cached = loadCachedTc(fecha);
		if (cached) return cached;
	}

	const [y, m] = fecha.split("-").map(Number);
	// SUNAT's `mes` is zero-indexed (JS getMonth()).
	let rows = await fetchMonth(y, m - 1);
	let parsed = selectRateForDate(rows, fecha);

	// A date early in the month can fall back to the previous month's last
	// published rate (e.g. Jan 1st, or a Monday holiday after a long weekend).
	if (!parsed) {
		const prevY = m === 1 ? y - 1 : y;
		const prevM = m === 1 ? 12 : m - 1;
		rows = await fetchMonth(prevY, prevM - 1);
		parsed = selectRateForDate(rows, fecha);
	}

	if (!parsed) {
		throw new Error(`SUNAT published no tipo de cambio on or before ${fecha}.`);
	}

	const rate: TipoCambioRate = {
		fecha,
		compra: parsed.compra,
		venta: parsed.venta,
		moneda: "USD",
		source: "sunat",
		fetchedAt: new Date().toISOString(),
		...(parsed.publicada !== fecha ? { publicada: parsed.publicada } : {}),
	};
	saveTc(rate);
	return rate;
}
