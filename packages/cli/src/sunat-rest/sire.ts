/**
 * SIRE — Sistema Integrado de Registros Electrónicos.
 *
 * SUNAT module to handle the monthly Registro de Ventas e Ingresos (RVIE)
 * and Registro de Compras (RCE) electronic books.
 *
 * Auth: OAuth 2.0 password grant against api-seguridad.sunat.gob.pe
 *   - client_id + client_secret (from SOL → Credenciales API SUNAT,
 *     URI scope = "MIGE RCE y RVIE - SIRE")
 *   - username = {RUC}{SOL_USER} concatenated, e.g. "20131312955MODDATOS"
 *   - password = SOL password
 *   - scope = "https://api-sire.sunat.gob.pe"
 *
 * Endpoints: api-sire.sunat.gob.pe
 *
 * Async pattern (most operations):
 *   1. Trigger operation (e.g. descargar propuesta) → returns ticket
 *   2. Poll ticket status until "Terminado"
 *   3. Download generated file by name
 */

import { callRestApi, getAccessToken, type OAuthCredentials } from "./oauth.ts";
import { tusUpload } from "./tus.ts";

/** Catálogo SUNAT de libros */
export const COD_LIBRO = {
	rvie: "140000", // Registro de Ventas e Ingresos
	rce: "080000", // Registro de Compras
} as const;

export type CodLibro = (typeof COD_LIBRO)[keyof typeof COD_LIBRO];

/**
 * Build SIRE credentials from RUC + SOL_USER + SOL_PASSWORD + client_id/secret.
 */
export function sireCredentials(args: {
	clientId: string;
	clientSecret: string;
	ruc: string;
	solUsuario: string;
	solPassword: string;
}): OAuthCredentials {
	return {
		clientId: args.clientId,
		clientSecret: args.clientSecret,
		username: `${args.ruc}${args.solUsuario}`,
		password: args.solPassword,
		scope: "https://api-sire.sunat.gob.pe",
	};
}

// ---------------------------------------------------------------------------
// 5.2 Consultar periodos disponibles
// ---------------------------------------------------------------------------

export interface SirePeriodoEntry {
	perTributario: string; // "202401"
	codEstado: string; // "01" presentado, "02" pendiente, etc
	desEstado: string; // human description
}

export interface SireEjercicio {
	numEjercicio: string; // "2024"
	desEstado: string;
	lisPeriodos: SirePeriodoEntry[];
}

export interface SirePeriodosResponse {
	registros: SireEjercicio[];
}

export async function listarPeriodos(codLibro: CodLibro, creds: OAuthCredentials): Promise<SireEjercicio[]> {
	const r = await callRestApi<SirePeriodosResponse | SireEjercicio[]>({
		creds,
		baseHost: "sire",
		path: `/contribuyente/migeigv/libros/rvierce/padron/web/omisos/${codLibro}/periodos`,
	});
	if (Array.isArray(r)) return r;
	return r.registros || [];
}

// ---------------------------------------------------------------------------
// 5.18 Descargar propuesta (async — returns ticket)
// 5.19 Descargar no incluidos (async)
// 5.20 Descargar resumen (async)
// 5.21 Descargar resumen inconsistencias (async)
// 5.27 Descargar RVIE por periodo (async)
// 5.31 Descargar reporte inconsistencias por periodo (async)
// ---------------------------------------------------------------------------

export interface DescargarOpts {
	codLibro: CodLibro;
	perTributario: string; // YYYYMM
	codTipoArchivo?: string; // 0 = TXT (default), 1 = CSV, etc
	codOrigenEnvio?: string; // "2" = Servicio Web (default)
	mtoTotalDesde?: string;
	mtoTotalHasta?: string;
	rucAdquiriente?: string;
	rucProveedor?: string;
}

export interface TicketResponse {
	numTicket: string;
}

/**
 * Each book exports its proposal from its own propuesta module, with the period
 * in the path: Manual API Registro de Ventas v30 §5.18 and Manual SIRE Compras
 * v28 §5.34. The shared `rvierce/gestionprocesosmasivos/.../exportapropuesta`
 * route of the v22 manual is gone; the gateway answers it, like any unknown
 * route, with a bare nginx 500 that reads as an outage. The format parameter is
 * `codTipoArchivo`, and RCE rejects the call with 422 without `codOrigenEnvio`.
 * Verified against production 2026-08-25.
 */
export async function descargarPropuesta(opts: DescargarOpts, creds: OAuthCredentials): Promise<string> {
	const libro = opts.codLibro === COD_LIBRO.rvie ? "rvie" : "rce";
	const action = opts.codLibro === COD_LIBRO.rvie ? "exportapropuesta" : "exportacioncomprobantepropuesta";
	const r = await callRestApi<TicketResponse>({
		creds,
		baseHost: "sire",
		method: "GET",
		path: `/contribuyente/migeigv/libros/${libro}/propuesta/web/propuesta/${opts.perTributario}/${action}`,
		query: {
			codTipoArchivo: opts.codTipoArchivo || "0",
			codOrigenEnvio: opts.codOrigenEnvio || "2",
		},
	});
	return r.numTicket;
}

export async function descargarRvie(perTributario: string, creds: OAuthCredentials): Promise<string> {
	const r = await callRestApi<TicketResponse>({
		creds,
		baseHost: "sire",
		method: "GET",
		path: `/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/exportarregistropropuesta`,
		query: {
			perTributario,
			codTipoArchivoReporte: "0",
			codLibro: COD_LIBRO.rvie,
		},
	});
	return r.numTicket;
}

// ---------------------------------------------------------------------------
// 5.16 Consultar estado del ticket
// ---------------------------------------------------------------------------

export interface TicketArchivo {
	nomArchivoReporte: string;
	/** As SUNAT returns it, with its misspelling. The download endpoint accepts either spelling. */
	codTipoAchivoReporte?: string;
	codTipoArchivoReporte?: string;
	nomArchivoContenido?: string;
}

export interface TicketStatus {
	numTicket: string;
	codEstadoProceso: string; // "01" iniciado, "03" en proceso, "06" terminado, "07" error, "10" terminado con error
	desEstadoProceso: string;
	/** The process that produced the ticket (Anexo I). The download endpoint needs it back. */
	codProceso?: string;
	desProceso?: string;
	perTributario?: string;
	codTipoArchivoReporte?: string;
	desTipoArchivoReporte?: string;
	archivoReporte?: TicketArchivo[];
}

/**
 * `consultaestadotickets` is a listing per period: `perIni`/`perFin` are
 * mandatory (Manual API Registro de Ventas v30 §5.16) and a request carrying
 * only `numTicket` is answered 422. The ticket number does not encode the
 * period, so callers must know which period the ticket belongs to.
 */
export async function consultarTicket(
	numTicket: string,
	creds: OAuthCredentials,
	perTributario: string,
): Promise<TicketStatus> {
	const path = `/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets`;
	type ApiResponse = { registros?: TicketStatus[] };
	const r = await callRestApi<ApiResponse>({
		creds,
		baseHost: "sire",
		method: "GET",
		path,
		query: { perIni: perTributario, perFin: perTributario, numTicket, page: 1, perPage: 50 },
	});
	const match = r.registros?.find((t) => t.numTicket === numTicket);
	if (!match) {
		return { numTicket, codEstadoProceso: "00", desEstadoProceso: "No encontrado" };
	}
	return match;
}

// ---------------------------------------------------------------------------
// 5.17 Descargar archivo (returns the actual ZIP/TXT bytes)
// ---------------------------------------------------------------------------

export interface DescargarArchivoOpts {
	nomArchivoReporte: string;
	codTipoArchivoReporte: string;
	codLibro: CodLibro;
	perTributario: string;
	/** The `codProceso` of the ticket that produced the file, e.g. "10" for an exported proposal. Mandatory. */
	codProceso: string;
	/** The ticket itself. Mandatory. */
	numTicket: string;
}

/**
 * Manual API Registro de Ventas v30 §5.17 lists `perTributario`, `codProceso`
 * and `numTicket` as mandatory alongside the file name; the URL template in
 * the same section omits them, and so did this function. Without either of
 * the two the server answers 500. Verified against production 2026-08-26.
 */
export async function descargarArchivo(opts: DescargarArchivoOpts, creds: OAuthCredentials): Promise<Buffer> {
	const token = await getAccessToken(creds);
	const url = new URL(
		`https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte`,
	);
	url.searchParams.set("nomArchivoReporte", opts.nomArchivoReporte);
	url.searchParams.set("codTipoArchivoReporte", opts.codTipoArchivoReporte);
	url.searchParams.set("codLibro", opts.codLibro);
	url.searchParams.set("perTributario", opts.perTributario);
	url.searchParams.set("codProceso", opts.codProceso);
	url.searchParams.set("numTicket", opts.numTicket);

	const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!resp.ok) {
		throw new Error(`SUNAT SIRE descargarArchivo failed with HTTP ${resp.status}`);
	}
	const ab = await resp.arrayBuffer();
	return Buffer.from(ab);
}

/**
 * The download options for the n-th file a finished ticket produced, or null
 * when the ticket lists no such file. The ticket carries everything the
 * download needs; this keeps callers from re-assembling six parameters.
 */
export function archivoDeTicket(
	ticket: { numTicket: string; codProceso?: string; archivoReporte?: TicketArchivo[] },
	codLibro: CodLibro,
	perTributario: string,
	index = 0,
): DescargarArchivoOpts | null {
	const a = ticket.archivoReporte?.[index];
	if (!a || !ticket.codProceso) return null;
	return {
		nomArchivoReporte: a.nomArchivoReporte,
		codTipoArchivoReporte: a.codTipoAchivoReporte ?? a.codTipoArchivoReporte ?? "00",
		codLibro,
		perTributario,
		codProceso: ticket.codProceso,
		numTicket: ticket.numTicket,
	};
}

// ---------------------------------------------------------------------------
// 5.8 Aceptar propuesta del RVIE
// ---------------------------------------------------------------------------

export interface AceptarPropuestaResult {
	numTicket: string;
}

export async function aceptarPropuestaRvie(
	perTributario: string,
	creds: OAuthCredentials,
): Promise<AceptarPropuestaResult> {
	const path = `/contribuyente/migeigv/libros/rvie/propuesta/web/propuesta/${perTributario}/aceptapropuesta`;
	const r = await callRestApi<AceptarPropuestaResult>({
		creds,
		baseHost: "sire",
		method: "POST",
		path,
	});
	return r;
}

// ---------------------------------------------------------------------------
// Polling helper — wait for ticket to terminate
// ---------------------------------------------------------------------------

export type TicketTerminalState = "completed" | "error" | "still-processing";

export interface PollTicketResult {
	state: TicketTerminalState;
	statusCode: string;
	statusDesc: string;
	numTicket: string;
	codProceso?: string;
	archivoReporte?: TicketArchivo[];
}

export interface PollTicketOpts {
	creds: OAuthCredentials;
	numTicket: string;
	/** The period the ticket belongs to; the status endpoint cannot be queried without it. */
	perTributario: string;
	timeoutMs?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	onTick?: (attempt: number, state: string) => void;
}

export async function pollTicket(opts: PollTicketOpts): Promise<PollTicketResult> {
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	const start = Date.now();
	let delay = opts.initialDelayMs ?? 2000;
	const maxDelay = opts.maxDelayMs ?? 30_000;
	let attempt = 0;
	while (Date.now() - start < timeoutMs) {
		attempt += 1;
		const status = await consultarTicket(opts.numTicket, opts.creds, opts.perTributario);
		opts.onTick?.(attempt, status.desEstadoProceso);
		// 06 = Terminado, 07/10 = error/terminado con error
		if (status.codEstadoProceso === "06") {
			return {
				state: "completed",
				statusCode: status.codEstadoProceso,
				statusDesc: status.desEstadoProceso,
				numTicket: status.numTicket,
				codProceso: status.codProceso,
				archivoReporte: status.archivoReporte,
			};
		}
		if (["07", "10", "08"].includes(status.codEstadoProceso)) {
			return {
				state: "error",
				statusCode: status.codEstadoProceso,
				statusDesc: status.desEstadoProceso,
				numTicket: status.numTicket,
				codProceso: status.codProceso,
			};
		}
		await sleep(delay);
		delay = Math.min(delay * 2, maxDelay);
	}
	return {
		state: "still-processing",
		statusCode: "98",
		statusDesc: `Timeout after ${Math.round((Date.now() - start) / 1000)}s`,
		numTicket: opts.numTicket,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// 5.3 Importar reemplazo de la propuesta (TUS.IO upload)
// 5.4 Importar nuevos comprobantes propuesta (TUS.IO upload)
// 5.5 Importar nuevos comprobantes preliminar (TUS.IO upload)
// 5.6 Importar ajustes posteriores (TUS.IO upload)
// 5.7 Importar ajustes posteriores de periodos anteriores (TUS.IO upload)
//
// All five share the same TUS upload mechanism. They differ in:
//   - the upload endpoint (URL path)
//   - the codProceso metadata value (3=Reemplazo, 1=ImportarCP, 4=ImportarPreliminar, 6=Ajustes, 7=AjustesAnteriores)
//
// Returns numTicket — same async polling flow as the read endpoints.
// ---------------------------------------------------------------------------

const SIRE_BASE = "https://api-sire.sunat.gob.pe/v1";

/** SUNAT codProceso values from Anexo I (Indicador de carga masiva) */
export const COD_PROCESO = {
	importarPropuestaCp: "1",
	reemplazoPropuesta: "3",
	importarPreliminarCp: "4",
	ajustesPosteriores: "6",
	ajustesPosterioresAnteriores: "7",
} as const;

export type CodProceso = (typeof COD_PROCESO)[keyof typeof COD_PROCESO];

const SIRE_UPLOAD_PATHS = {
	reemplazoPropuesta: "/contribuyente/migeigv/libros/rvierce/receptorpropuesta/web/propuesta/upload",
	importarPropuestaCp: "/contribuyente/migeigv/libros/rvierce/receptorpropuesta/web/propuesta/upload",
	importarPreliminarCp: "/contribuyente/migeigv/libros/rvierce/receptorpreliminar/web/preliminar/upload",
	ajustesPosteriores: "/contribuyente/migeigv/libros/rvierce/receptorajustesposteriores/web/ajustesposteriores/upload",
	ajustesPosterioresAnteriores:
		"/contribuyente/migeigv/libros/rvierce/receptorajustesposteriores/web/ajustesposteriores/upload",
} as const;

export type SireUploadKind = keyof typeof SIRE_UPLOAD_PATHS;

export interface SireUploadOpts {
	kind: SireUploadKind;
	codLibro: CodLibro;
	perTributario: string; // YYYYMM
	filename: string; // e.g. "LE201013129550014040002OIM2.txt" — see SUNAT Resolución 112-2021 tabla 6
	data: Buffer; // ZIP bytes (the .txt is wrapped in a .zip per SUNAT spec)
	chunkSize?: number;
	onProgress?: (uploaded: number, total: number) => void;
}

export interface SireUploadResult {
	numTicket: string;
	uploadUrl: string;
	bytesSent: number;
}

export async function sireUpload(opts: SireUploadOpts, creds: OAuthCredentials): Promise<SireUploadResult> {
	const codProceso = COD_PROCESO[opts.kind];
	const path = SIRE_UPLOAD_PATHS[opts.kind];
	const endpoint = `${SIRE_BASE}${path}`;
	const token = await getAccessToken(creds);

	const { uploadUrl, bytesSent } = await tusUpload({
		endpoint,
		data: opts.data,
		bearerToken: token,
		chunkSize: opts.chunkSize,
		onProgress: opts.onProgress,
		metadata: {
			filename: opts.filename,
			filetype: "application/zip",
			perTributario: opts.perTributario,
			codOrigenEnvio: "2", // Servicio Web
			codProceso,
			codTipoCorrelativo: "01", // envíos masivos
			nomArchivoImportacion: opts.filename,
			codLibro: opts.codLibro,
		},
	});

	// SUNAT returns the ticket either in the final PATCH response body (rare)
	// or via a separate consultaestadotickets call seeded by the upload location.
	// Per Manual Section 5.3 page 24, the response body of the final PATCH
	// contains the ticket as plain text. We HEAD the upload location to check.
	// For now we extract from the location URL or fetch the upload metadata.
	const ticket = extractTicketFromUploadUrl(uploadUrl) || "";
	return { numTicket: ticket, uploadUrl, bytesSent };
}

/**
 * SUNAT upload locations look like ".../upload/{filename-base64}/{ticketId}".
 * Best-effort extraction; if not present, the caller should poll
 * consultarTicket using the metadata they sent (perTributario + codProceso).
 */
function extractTicketFromUploadUrl(url: string): string | null {
	// Match any 13-digit numeric segment (SUNAT ticket format AAAA99999999)
	const match = url.match(/(\d{13,})/);
	return match ? match[1] : null;
}
