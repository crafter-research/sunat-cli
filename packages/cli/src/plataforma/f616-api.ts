import { plataformaGet } from "./session.ts";

/**
 * F616 (Trabajador Independiente) read endpoints on the Nueva Plataforma API.
 *
 * Base path and routes read from the portal's own unminified bundle
 * `constantes-0616.js` during recon (2026-08-09). `obtenerPeriodo` and
 * `obtenerListaOficios` are observed HTTP 200; the rest are read from source
 * and confirmed one at a time as they are wired.
 *
 * `periodo` is MMYYYY with no separator: 032026 for March 2026.
 */

const BASE = "/v1/recaudacion/tributaria/declaracion/pagoelectronico/trabajadorindependiente";

function periodoToMMYYYY(periodo: string): string {
	// Accept 2026-03 or 03/2026 or 032026, emit 032026.
	const digits = periodo.replace(/[^0-9]/g, "");
	if (/^\d{4}\d{2}$/.test(digits) && periodo.includes("-")) {
		// 2026-03 -> 202603 -> reorder to 032026
		return digits.slice(4) + digits.slice(0, 4);
	}
	if (/^\d{6}$/.test(digits)) return digits; // already MMYYYY
	throw new Error(`Unrecognized periodo "${periodo}". Use YYYY-MM.`);
}

/** Open a period: returns comprobante types, interest-rate table, today's date. Observed 200. */
export function obtenerPeriodo(periodo: string): Promise<unknown> {
	return plataformaGet(`${BASE}/e/obtenerPeriodo/${periodoToMMYYYY(periodo)}`);
}

/** Profession catalog (the disabled combobox in the form). Observed 200. */
export function obtenerListaOficios(): Promise<unknown> {
	return plataformaGet(`${BASE}/e/obtenerListaOficios`);
}

/** Prior-period credit for a given period. Read from source, not yet confirmed. */
export function obtenerSaldoAFavorPeriodoAnterior(periodo: string): Promise<unknown> {
	return plataformaGet(`${BASE}/t/consulta/obtenerSaldoAFavorPeriodoAnterior/${periodoToMMYYYY(periodo)}`);
}

/** Company lookup by RUC. Read from source, not yet confirmed. */
export function obtenerDatosEmpresa(ruc: string): Promise<unknown> {
	return plataformaGet(`${BASE}/e/obtenerDatosEmpresa/${ruc}`);
}
