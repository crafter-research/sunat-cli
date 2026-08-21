import { RENTA_API, readToken } from "./session.ts";

/**
 * F709 (Renta Anual - Persona Natural) read API on e-renta.sunat.gob.pe.
 *
 * Every endpoint here was exercised with plain fetch and the browser closed
 * (recon 2026-08-21, see recon/sunat-f709-erenta-api.md). Auth is a bearer JWT
 * plus a client-version header; there are no cookies involved.
 *
 * Read-only by design. The submission path
 * (`orquestacionpresentacion/procesarPresentarPagar`) is deliberately absent:
 * filing an annual return is irreversible and its request body has not been
 * captured, so there is nothing here that can file, pay, or amend.
 */

/**
 * SUNAT rejects a non-browser User-Agent on its portals: the connection closes
 * with an empty reply. Verified from two countries, so it is UA filtering
 * rather than geo-blocking.
 */
const BROWSER_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * e-renta sits behind an F5 BIG-IP ASM that blocks on request rate, keyed to
 * source IP. Observed 2026-08-21: ~15-20 requests within seconds made every
 * subsequent request return a static nginx 500 page for 1-2 minutes, including
 * paths that had just answered normally, and a fresh cookie jar did not clear
 * it. No Retry-After or X-RateLimit-* header is sent, so the only defense is
 * pacing.
 *
 * Hence a serialized queue with a floor between calls. A CLI that fans out
 * would take the whole host away from the user for minutes.
 */
const MIN_REQUEST_GAP_MS = 1200;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

async function paced<T>(fn: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		try {
			return await fn();
		} finally {
			lastRequestAt = Date.now();
		}
	});
	queue = run.then(
		() => undefined,
		() => undefined,
	);
	return run as Promise<T>;
}

export class RentaApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly hint?: string,
	) {
		super(message);
		this.name = "RentaApiError";
	}
}

function authHeaders(): Record<string, string> {
	const cached = readToken();
	if (!cached) {
		throw new RentaApiError("No e-renta session.", 401, "no-token", "Run 'sunat-cli renta login' first.");
	}
	return {
		Authorization: `Bearer ${cached.token}`,
		// Load-bearing. Without it the API answers 422/42209 "version obsoleta".
		"version-web": cached.versionWeb,
		Accept: "application/json",
		"User-Agent": BROWSER_UA,
	};
}

async function get<T>(path: string): Promise<T> {
	return paced(async () => {
		const res = await fetch(`${RENTA_API}${path}`, { headers: authHeaders() });
		const body = await res.text();

		if (res.status === 401) {
			throw new RentaApiError("e-renta session expired.", 401, "expired", "Run 'sunat-cli renta login' again.");
		}

		// The WAF block returns an nginx HTML page, not JSON. Distinguish it from a
		// genuinely dead endpoint so the caller waits instead of giving up.
		if (res.status >= 500 && body.includes("nginx")) {
			throw new RentaApiError(
				"e-renta refused the request (rate limit or upstream error).",
				res.status,
				"throttled",
				"SUNAT throttles by IP for 1-2 minutes. Wait, then retry.",
			);
		}

		// An empty body is how this API answers "nothing matched": an unknown
		// idPresentacion returns HTTP 202 with zero bytes rather than a 404.
		// Measured 2026-08-21 against a made-up id.
		if (body.trim() === "") {
			throw new RentaApiError(
				"SUNAT returned no data for that request.",
				res.status,
				"empty",
				"Check the identifier. Filing ids come from 'sunat-cli renta presentaciones'.",
			);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new RentaApiError(`Unexpected non-JSON response (HTTP ${res.status}).`, res.status, "bad-response");
		}

		// SUNAT's error envelope: { cod, msg, errors: [{ cod, msg }] }
		if (!res.ok) {
			const env = parsed as { cod?: number | string; errors?: Array<{ cod?: number; msg?: string }> };
			const first = env.errors?.[0];
			const code = String(first?.cod ?? env.cod ?? res.status);
			// 42209 is the client-version gate. Surface it verbatim: retrying cannot fix it.
			const hint =
				code === "42209"
					? "SUNAT bumped its client version. Run 'sunat-cli renta login' to pick up the new one."
					: undefined;
			throw new RentaApiError(first?.msg || `HTTP ${res.status}`, res.status, code, hint);
		}

		return parsed as T;
	});
}

/** The annual period is `{ejercicio}13` — month sentinel 13, not a real month. */
export function periodoAnual(ejercicio: number | string): string {
	return `${ejercicio}13`;
}

export interface Casilla {
	numCas: string;
	descripcion: string;
	indObligatorio: boolean;
	indEditable: boolean;
}

export interface FormularioMeta {
	codFormulario: string;
	descripcion: string;
	ejercicio: string;
	esPresentacion: boolean;
	ayudas?: Array<{ codAyuda: string; descripcion: string; uri: string }>;
}

export interface Presentacion {
	tipoDeclaracion: string;
	desTipoDeclaracion: string;
	codFor: string;
	numOrden: number;
	perTri: string;
	ejercicio: string;
	idPresentacion: string;
	web: boolean;
	mtoPag: number;
	desMedPago: string | null;
	fecDeclaracion: string;
	desFor: string;
}

export interface Declaracion {
	perTri: number;
	numRuc: string;
	valHash: string;
	declaracion: {
		generales?: Record<string, unknown>;
		seccInformativa?: Record<string, unknown>;
		seccDeterminativa?: Record<string, unknown>;
		determinacionDeuda?: Record<string, unknown>;
	};
}

export function obtenerFechaHora(): Promise<{ fecha: string; hora: string }> {
	return get("/formularioutil/consulta/especifica/obtenerFechaHora");
}

export function obtenerFormulario(ejercicio: number | string): Promise<FormularioMeta> {
	return get(`/parametriaformulario/web/${ejercicio}/formulario/0709`);
}

export function obtenerCasillas(ejercicio: number | string): Promise<Casilla[]> {
	return get(`/parametriaformulario/web/${ejercicio}/formulario/0709/casilla`);
}

export function obtenerDeclaracion(ruc: string, ejercicio: number | string): Promise<Declaracion> {
	const periodo = periodoAnual(ejercicio);
	return get(`/predeclaracion?ruc=${ruc}&periodo=${periodo}&formulario=0709&tipodeclaracion=01`);
}

/**
 * Filing history.
 *
 * GOTCHA: this endpoint wants `formulario=709`, WITHOUT the leading zero, while
 * every other endpoint wants `0709`. Measured by contrast 2026-08-21:
 * 709 -> 200, 0709 -> 422/42210 "El codigo de formulario es incorrecto",
 * 00709 -> 422. Do not "fix" this to match its neighbours.
 */
export async function listarPresentaciones(ruc: string, ejercicio: number | string): Promise<Presentacion[]> {
	const res = await get<{ presentacion?: Presentacion[] }>(
		`/consultadeclaracion/e/presentacion/resumen?numRuc=${ruc}&numEjercicio=${ejercicio}&formulario=709&indMedPres=1`,
	);
	return res.presentacion ?? [];
}

export function obtenerConstancia(idPresentacion: string): Promise<{ resultado: Record<string, unknown> }> {
	return get(`/orquestacionpresentacion/consulta/obtenerConstancia/${idPresentacion}`);
}

export function obtenerDetalle(idPresentacion: string): Promise<Record<string, unknown>> {
	return get(`/consultadeclaracion/e/presentacion/detallado/${idPresentacion}`);
}
