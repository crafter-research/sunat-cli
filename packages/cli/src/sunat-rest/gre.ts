/**
 * SUNAT GRE — Guía de Remisión Electrónica REST API.
 *
 * Distinct from CPE SOAP (factura/boleta) and from SIRE:
 *   - Host: api-cpe.sunat.gob.pe (NOT api.sunat.gob.pe, NOT api-sire)
 *   - OAuth scope: https://api-cpe.sunat.gob.pe
 *   - Auth: password grant (RUC + SOL_USER + SOL_PASSWORD), same flavor as SIRE
 *   - Body: JSON with arcGreZip (the signed XML, zipped, then base64-encoded)
 *
 * Async pattern same as SIRE: send → ticket → poll status → CDR ZIP
 */

import { createHash } from "crypto";
import { type OAuthCredentials, callRestApi, getAccessToken } from "./oauth.ts";
import { zipSingleFile } from "../cpe/soap/zip.ts";

/**
 * Build SIRE-style credentials for GRE (same shape, different scope).
 * Reuses RUC + SOL_USER + SOL_PASSWORD env vars.
 */
export function greCredentials(args: {
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
		scope: "https://api-cpe.sunat.gob.pe",
	};
}

export interface GreSendInput {
	filename: string; // e.g. "20131312955-09-T001-1234" (without extension)
	signedXml: string; // signed UBL DespatchAdvice
}

export interface GreSendResponse {
	numTicket: string;
}

/**
 * POST /v1/contribuyente/gem/comprobantes/{filename}
 *
 * Body: { archivo: { nomArchivo, arcGreZip, hashZip } }
 *   - nomArchivo: filename + ".zip"
 *   - arcGreZip: base64 of (zip containing filename + ".xml")
 *   - hashZip: SHA256 of the zip bytes (lowercase hex)
 */
export async function enviarGre(input: GreSendInput, creds: OAuthCredentials): Promise<GreSendResponse> {
	const xmlFilename = `${input.filename}.xml`;
	const zipFilename = `${input.filename}.zip`;
	const zipBuffer = await zipSingleFile(xmlFilename, input.signedXml);
	const arcGreZip = zipBuffer.toString("base64");
	const hashZip = createHash("sha256").update(zipBuffer).digest("hex");

	const body = {
		archivo: {
			nomArchivo: zipFilename,
			arcGreZip,
			hashZip,
		},
	};

	return callRestApi<GreSendResponse>({
		creds,
		method: "POST",
		path: `/contribuyente/gem/comprobantes/${encodeURIComponent(input.filename)}`,
		body,
		baseHost: "cpe",
	});
}

export interface GreStatusResponse {
	numTicket: string;
	codRespuesta: string; // "0001" Aceptado, "0002" Anulado, "0003" Rechazado, "0098" En proceso
	desRespuesta?: string;
	indCdrGenerado?: string; // "1" if CDR was generated
	arcCdr?: string; // base64-encoded CDR ZIP (when indCdrGenerado=1)
}

/**
 * GET /v1/contribuyente/gem/comprobantes/envios/{ticket}
 */
export async function consultarGreTicket(numTicket: string, creds: OAuthCredentials): Promise<GreStatusResponse> {
	return callRestApi<GreStatusResponse>({
		creds,
		baseHost: "cpe",
		path: `/contribuyente/gem/comprobantes/envios/${encodeURIComponent(numTicket)}`,
	});
}

export interface GrePollResult {
	state: "completed" | "rejected" | "still-processing";
	codRespuesta: string;
	desRespuesta?: string;
	arcCdr?: string;
}

export interface GrePollOpts {
	creds: OAuthCredentials;
	numTicket: string;
	timeoutMs?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	onTick?: (attempt: number, state: string) => void;
}

export async function pollGreTicket(opts: GrePollOpts): Promise<GrePollResult> {
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	const start = Date.now();
	let delay = opts.initialDelayMs ?? 2000;
	const maxDelay = opts.maxDelayMs ?? 30_000;
	let attempt = 0;

	while (Date.now() - start < timeoutMs) {
		attempt += 1;
		const status = await consultarGreTicket(opts.numTicket, opts.creds);
		opts.onTick?.(attempt, status.codRespuesta);
		if (status.codRespuesta === "0001") {
			return { state: "completed", codRespuesta: status.codRespuesta, desRespuesta: status.desRespuesta, arcCdr: status.arcCdr };
		}
		if (status.codRespuesta === "0002" || status.codRespuesta === "0003") {
			return { state: "rejected", codRespuesta: status.codRespuesta, desRespuesta: status.desRespuesta, arcCdr: status.arcCdr };
		}
		// 0098 / unknown → still processing
		await sleep(delay);
		delay = Math.min(delay * 2, maxDelay);
	}
	return { state: "still-processing", codRespuesta: "0098", desRespuesta: `Timeout after ${Math.round((Date.now() - start) / 1000)}s` };
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
