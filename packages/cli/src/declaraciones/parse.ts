/**
 * Pure parsing for the "Consulta de declaraciones" visor. No I/O here so the
 * shapes SUNAT actually renders can be pinned by fixtures in tests/unit.
 */

import type { DeclaracionRow } from "./types.ts";

export class DeclaracionesInputError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly hint?: string,
	) {
		super(message);
		this.name = "DeclaracionesInputError";
	}
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** DD/MM/YYYY → Date (local midnight) or null when the text is not a calendar date. */
export function parseFechaSunat(value: string): Date | null {
	const m = value.match(DATE_RE);
	if (!m) return null;
	const [, dd, mm, yyyy] = m;
	const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
	if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return null;
	return d;
}

export function formatFechaSunat(d: Date): string {
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * The visor refuses ranges wider than six months (`diferenciaMayor6meses` in
 * its inline JS) and silently returns nothing for reversed ranges. Both are
 * caught here so the operator gets a message instead of an empty table.
 */
export function validateRango(desde: string, hasta: string): void {
	const d = parseFechaSunat(desde);
	const h = parseFechaSunat(hasta);
	if (!d || !h) {
		throw new DeclaracionesInputError(
			"Dates must be DD/MM/YYYY.",
			"bad-date",
			"Example: --desde 01/06/2026 --hasta 27/08/2026",
		);
	}
	if (d > h) throw new DeclaracionesInputError("--desde is after --hasta.", "reversed-range");
	const limit = new Date(d);
	limit.setMonth(limit.getMonth() + 6);
	if (h > limit) {
		throw new DeclaracionesInputError(
			"SUNAT limits this query to six months per request.",
			"range-too-wide",
			"Split the range into two calls.",
		);
	}
}

/** `601` → `0601`. SUNAT prints four digits; operators rarely type the zero. */
export function normalizeFormulario(value: string): string {
	const digits = value.trim();
	if (!/^\d{3,4}$/.test(digits)) {
		throw new DeclaracionesInputError(
			"Form code must be 3 or 4 digits.",
			"bad-formulario",
			"Example: 0601, 0621, 1663",
		);
	}
	return digits.padStart(4, "0");
}

export function normalizePeriodo(value: string): string {
	const v = value.trim();
	if (!/^\d{4}(0[1-9]|1[0-3])$/.test(v)) {
		throw new DeclaracionesInputError(
			"Period must be YYYYMM.",
			"bad-periodo",
			"Example: 202607 (annual returns use YYYY13)",
		);
	}
	return v;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&deg;/g, "°")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cellText(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * True when the response is the SOL login page or the menu instead of the
 * visor: the ww1 session is created by the menu hop, so a stale cookie jar
 * answers 200 with a page that has no results table.
 */
export function looksLikeLostSession(html: string): boolean {
	return (
		/txtContrasena|Iniciar sesi[oó]n|MenuInternet\.htm\?pestana/i.test(html) && !/Consulta de Declaraciones/i.test(html)
	);
}

export function hasNoResultsNotice(html: string): boolean {
	return /No se encontraron declaraciones/i.test(html);
}

export interface ListaPagination {
	pagina: number;
	tamanioPagina: number;
}

function attribute(tag: string, name: string): string | undefined {
	const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
	return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : undefined;
}

export function parseListaPagination(html: string): ListaPagination | null {
	const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(
		(match) => attribute(match[1], "name") === "formPaginacion" || attribute(match[1], "id") === "formPaginacion",
	);
	if (!form) return null;
	const fields = new Map<string, string>();
	for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
		const name = attribute(input[1], "name");
		if (name) fields.set(name, attribute(input[1], "value") ?? "");
	}
	for (const select of form[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
		const name = attribute(select[1], "name");
		const options = [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
		const selected = options.find((option) => /(?:^|\s)selected(?:\s|=|$)/i.test(option[1])) ?? options[0];
		if (name && selected) fields.set(name, attribute(selected[1], "value") ?? cellText(selected[2]));
	}
	const pagina = fields.get("pagina") ?? "";
	const tamanioPagina = fields.get("tamanioPagina") ?? "";
	if (
		![pagina, tamanioPagina].every(
			(value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0,
		)
	) {
		throw new Error("SUNAT returned invalid pagination fields.");
	}
	return { pagina: Number(pagina), tamanioPagina: Number(tamanioPagina) };
}

const CONSTANCIA_RE = /constanciaNP\(\s*(\d+)\s*,\s*'(\d{3,4})'\s*\)/;
const COMPROBANTE_RE = /comprobante\(\s*'(\d{3,4})'\s*,\s*(\d+)\s*,\s*'[^']*'\s*,\s*(\d+)\s*\)/;

/**
 * Rows look like:
 *   <tr><td>4</td><td>10/03/2026</td><td>202602</td><td>0601</td>
 *       <td>PLANILLA ELECTRONICA</td><td>1000000004</td>
 *       <td><a href="javascript:constanciaNP(1000000004,'0601')">Comprobante</a></td></tr>
 * (synthetic values; the layout is the one observed live)
 * Boletas carry `comprobante('1663',<numPres>,'',<numOrden>)` instead. The
 * anchor is the source of truth for numOrden and codFor; the cells are kept
 * for the dates and labels. Header and pagination rows have no anchor and are
 * skipped. 0709/0710 rows use `comprobanteNSIR(...)`; they are listed but their
 * constancia goes through a different servlet (see portal.ts).
 */
export function parseListaHtml(html: string): DeclaracionRow[] {
	const rows: DeclaracionRow[] = [];
	const trs = html.split(/<tr\b/i).slice(1);
	for (const tr of trs) {
		const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
		if (cells.length < 6) continue;
		const [, fecha, periodo, codForm, descForm, numOrdenCell] = cells;
		if (!parseFechaSunat(fecha) || !/^\d{6}$/.test(periodo)) continue;

		const constancia = tr.match(CONSTANCIA_RE);
		const comprobante = tr.match(COMPROBANTE_RE);
		if (constancia) {
			rows.push({
				fechaPresentacion: fecha,
				periodo,
				formulario: constancia[2].padStart(4, "0"),
				descripcion: descForm,
				numOrden: constancia[1],
				kind: "declaracion",
			});
		} else if (comprobante) {
			rows.push({
				fechaPresentacion: fecha,
				periodo,
				formulario: comprobante[1].padStart(4, "0"),
				descripcion: descForm,
				numOrden: comprobante[3],
				kind: "pago",
				numPresentacion: comprobante[2],
			});
		} else if (/^\d+$/.test(numOrdenCell) && /^\d{3,4}$/.test(codForm)) {
			// Annual returns (comprobanteNSIR) and anything SUNAT adds later: keep
			// the row so the listing is complete, typed as a declaration.
			rows.push({
				fechaPresentacion: fecha,
				periodo,
				formulario: codForm.padStart(4, "0"),
				descripcion: descForm,
				numOrden: numOrdenCell,
				kind: "declaracion",
			});
		}
	}
	return rows;
}

/**
 * `accion=validar_constanciaNP` answers `<codigo>{GUID}</codigo>`; `0` means
 * SUNAT has not rendered the PDF yet ("aun no se encuentra disponible").
 */
export function parseCodigoConstancia(xml: string): string | null {
	const m = xml.match(/<codigo>\s*([^<]+?)\s*<\/codigo>/i);
	if (!m) return null;
	return m[1] === "0" ? null : m[1];
}

export function isPdf(bytes: Uint8Array): boolean {
	return bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}
