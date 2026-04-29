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

import { type OAuthCredentials, callRestApi, getAccessToken } from "./oauth.ts";
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

export async function descargarPropuesta(opts: DescargarOpts, creds: OAuthCredentials): Promise<string> {
	const path = opts.codLibro === COD_LIBRO.rvie
		? `/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/exportapropuesta`
		: `/contribuyente/migeigv/libros/rce/propuesta/web/propuesta/${opts.perTributario}/exportacioncomprobantepropuesta`;

	const r = await callRestApi<TicketResponse>({
		creds,
		baseHost: "sire",
		method: "GET",
		path,
		query: {
			perTributario: opts.perTributario,
			codTipoArchivoReporte: opts.codTipoArchivo || "0",
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

export interface TicketStatus {
	numTicket: string;
	codEstadoProceso: string; // "01" iniciado, "03" en proceso, "06" terminado, "07" error, "10" terminado con error
	desEstadoProceso: string;
	codTipoArchivoReporte?: string;
	desTipoArchivoReporte?: string;
	archivoReporte?: { nomArchivoReporte: string; codTipoArchivoReporte?: string }[];
}

export async function consultarTicket(numTicket: string, creds: OAuthCredentials): Promise<TicketStatus> {
	const path = `/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets`;
	type ApiResponse = { registros?: TicketStatus[] };
	const r = await callRestApi<ApiResponse>({
		creds,
		baseHost: "sire",
		method: "GET",
		path,
		query: { numTicket, page: 1, perPage: 1 },
	});
	const first = r.registros?.[0];
	if (!first) {
		return { numTicket, codEstadoProceso: "00", desEstadoProceso: "No encontrado" };
	}
	return first;
}

// ---------------------------------------------------------------------------
// 5.17 Descargar archivo (returns the actual ZIP/TXT bytes)
// ---------------------------------------------------------------------------

export interface DescargarArchivoOpts {
	nomArchivoReporte: string;
	codTipoArchivoReporte: string;
	codLibro: CodLibro;
	perTributario: string;
	codProceso?: string; // tipo de proceso, depende del archivo origen
}

export async function descargarArchivo(
	opts: DescargarArchivoOpts,
	creds: OAuthCredentials,
): Promise<Buffer> {
	const token = await import("./oauth.ts").then((m) => m.getAccessToken(creds));
	const url = new URL(`https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte`);
	url.searchParams.set("nomArchivoReporte", opts.nomArchivoReporte);
	url.searchParams.set("codTipoArchivoReporte", opts.codTipoArchivoReporte);
	url.searchParams.set("codLibro", opts.codLibro);
	url.searchParams.set("perTributario", opts.perTributario);
	if (opts.codProceso) url.searchParams.set("codProceso", opts.codProceso);

	const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`SUNAT SIRE descargarArchivo HTTP ${resp.status}: ${text.slice(0, 300)}`);
	}
	const ab = await resp.arrayBuffer();
	return Buffer.from(ab);
}

// ---------------------------------------------------------------------------
// 5.8 Aceptar propuesta del RVIE
// ---------------------------------------------------------------------------

export interface AceptarPropuestaResult {
	numTicket: string;
}

export async function aceptarPropuestaRvie(perTributario: string, creds: OAuthCredentials): Promise<AceptarPropuestaResult> {
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
	archivoReporte?: { nomArchivoReporte: string; codTipoArchivoReporte?: string }[];
}

export interface PollTicketOpts {
	creds: OAuthCredentials;
	numTicket: string;
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
		const status = await consultarTicket(opts.numTicket, opts.creds);
		opts.onTick?.(attempt, status.desEstadoProceso);
		// 06 = Terminado, 07/10 = error/terminado con error
		if (status.codEstadoProceso === "06") {
			return {
				state: "completed",
				statusCode: status.codEstadoProceso,
				statusDesc: status.desEstadoProceso,
				archivoReporte: status.archivoReporte,
			};
		}
		if (["07", "10", "08"].includes(status.codEstadoProceso)) {
			return {
				state: "error",
				statusCode: status.codEstadoProceso,
				statusDesc: status.desEstadoProceso,
			};
		}
		await sleep(delay);
		delay = Math.min(delay * 2, maxDelay);
	}
	return { state: "still-processing", statusCode: "98", statusDesc: `Timeout after ${Math.round((Date.now() - start) / 1000)}s` };
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
	ajustesPosterioresAnteriores: "/contribuyente/migeigv/libros/rvierce/receptorajustesposteriores/web/ajustesposteriores/upload",
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
