/**
 * Tipo de Cambio SUNAT — daily official rate scraper.
 *
 * SUNAT publishes the official TC at:
 *   https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias
 *
 * Direct fetch is blocked by SUNAT's WAF (returns "Request Rejected").
 * Workaround: drive a real Chrome session via `agent-browser`, pull the
 * rendered HTML/snapshot, parse the compra/venta values from the table.
 *
 * Cache: by ISO date at ~/.sunat/cache/tipo-cambio.jsonl (one line per date).
 * SUNAT publishes once per business day; weekend/feriado returns the
 * previous business day's rate (which is the legally-valid TC for those days).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "../data/config.ts";
import * as browser from "../browser/client.ts";

export interface TipoCambioRate {
	fecha: string; // YYYY-MM-DD — the date the rate applies to
	compra: number; // S/ per USD (compra)
	venta: number; // S/ per USD (venta)
	moneda: "USD"; // SUNAT only publishes USD/PEN officially
	source: "sunat";
	fetchedAt: string; // ISO timestamp when we scraped
}

const CACHE_FILE = join(paths.sunatDir, "cache", "tipo-cambio.jsonl");
const SUNAT_TC_URL = "https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias";

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

/**
 * Parse SUNAT's TC table snapshot for a given fecha.
 *
 * The page renders a table with rows like:
 *   "29 Abril 2026 | Compra: 3.760 | Venta: 3.768"
 *
 * The agent-browser snapshot output strips most layout but preserves
 * numbers + day labels. This parser is deliberately tolerant: it scans
 * for the compra/venta pair closest to a "DD MMMM YYYY" date matching
 * the requested fecha (or the most recent if fecha is the weekend).
 */
export function parseTcSnapshot(snapshot: string, fechaIso: string): { compra: number; venta: number } | null {
	// Try aria-label style first: "Compra 3.760 Venta 3.768"
	const ariaMatch = snapshot.match(/Compra[\s:]*([0-9]+\.[0-9]+)[\s\S]{0,40}Venta[\s:]*([0-9]+\.[0-9]+)/i);
	if (ariaMatch) {
		return { compra: Number.parseFloat(ariaMatch[1]), venta: Number.parseFloat(ariaMatch[2]) };
	}

	// Fall back to table cells: split into rows and find any row with two decimals near each other
	const lines = snapshot.split(/\r?\n/);
	for (const line of lines) {
		const m = line.match(/([0-9]+\.[0-9]{2,4})\s*[|\t,;\s]+\s*([0-9]+\.[0-9]{2,4})/);
		if (m) {
			const a = Number.parseFloat(m[1]);
			const b = Number.parseFloat(m[2]);
			// Sanity: TC values are between 1 and 10 soles per dollar realistically
			if (a > 1 && a < 10 && b > 1 && b < 10 && Math.abs(a - b) < 0.5) {
				return { compra: Math.min(a, b), venta: Math.max(a, b) };
			}
		}
	}
	return null;
}

export interface FetchTcOpts {
	fecha?: string; // YYYY-MM-DD; defaults to today
	force?: boolean; // bypass cache
}

/**
 * Public entry point. Returns cached if present (always cacheable, since
 * SUNAT publishes immutable historical TCs). Otherwise opens browser, scrapes,
 * caches, returns.
 */
export async function getTipoCambio(opts: FetchTcOpts = {}): Promise<TipoCambioRate> {
	const fecha = opts.fecha || new Date().toISOString().split("T")[0];

	if (!opts.force) {
		const cached = loadCachedTc(fecha);
		if (cached) return cached;
	}

	await browser.open(SUNAT_TC_URL, { headed: false });
	await browser.sleep(2500);
	const snapshot = await browser.snapshot();
	const parsed = parseTcSnapshot(snapshot, fecha);
	if (!parsed) {
		throw new Error(
			`Could not parse tipo de cambio from SUNAT page for ${fecha}. The portal may have changed layout. Run with --debug to inspect snapshot.`,
		);
	}

	const rate: TipoCambioRate = {
		fecha,
		compra: parsed.compra,
		venta: parsed.venta,
		moneda: "USD",
		source: "sunat",
		fetchedAt: new Date().toISOString(),
	};
	saveTc(rate);
	return rate;
}
