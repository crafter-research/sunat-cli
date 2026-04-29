/**
 * SOAP client for SUNAT BillService.
 *
 * Methods:
 *   - sendBill (sync, returns CDR ZIP) — for individual Factura, Boleta>=S/700, NC, ND
 *   - sendSummary (async, returns ticket) — for daily summary of boletas (RC) and
 *     comunicacion de baja (RA)
 *   - getStatus (sync, takes ticket, returns CDR ZIP when ready)
 *
 * Auth: WS-Security UsernameToken with RUC + SOL_USER as username, SOL_PASSWORD as password.
 *
 * Endpoints (FAC/BOL/NCR/NDB/RC/RA):
 *   beta: https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService
 *   prod: https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService
 */

import { unzipNested, zipSingleFile } from "./zip.ts";
import { type CdrResponse, parseCdr } from "./cdr.ts";

export type SunatMode = "beta" | "prod";

export const SUNAT_ENDPOINTS_FAC: Record<SunatMode, string> = {
	beta: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
	prod: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
};

export interface SendBillArgs {
	mode: SunatMode;
	wsUsername: string;
	wsPassword: string;
	xml: string;
	filename: string;
}

export interface SendBillResult {
	cdr: CdrResponse;
	cdrZipBase64: string;
	httpStatus: number;
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSendBillEnvelope(args: { username: string; password: string; filename: string; zipBase64: string }): string {
	return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(args.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(args.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendBill>
      <fileName>${escapeXml(args.filename)}.zip</fileName>
      <contentFile>${args.zipBase64}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildSendSummaryEnvelope(args: { username: string; password: string; filename: string; zipBase64: string }): string {
	return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(args.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(args.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendSummary>
      <fileName>${escapeXml(args.filename)}.zip</fileName>
      <contentFile>${args.zipBase64}</contentFile>
    </ser:sendSummary>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildGetStatusEnvelope(args: { username: string; password: string; ticket: string }): string {
	return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(args.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(args.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatus>
      <ticket>${escapeXml(args.ticket)}</ticket>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractApplicationResponseBase64(soapXml: string): string | null {
	const match = soapXml.match(/<applicationResponse[^>]*>([\s\S]*?)<\/applicationResponse>/);
	return match ? match[1].trim() : null;
}

function extractTicket(soapXml: string): string | null {
	const match = soapXml.match(/<ticket[^>]*>([\s\S]*?)<\/ticket>/);
	return match ? match[1].trim() : null;
}

function extractStatusCode(soapXml: string): string | null {
	const match = soapXml.match(/<statusCode[^>]*>([\s\S]*?)<\/statusCode>/);
	return match ? match[1].trim() : null;
}

function extractStatusContent(soapXml: string): string | null {
	const match = soapXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
	return match ? match[1].trim() : null;
}

function extractFault(soapXml: string): { code: string; message: string } | null {
	const fault = soapXml.match(/<(?:soap-env:|soapenv:|S:)?Fault[\s\S]*?<\/(?:soap-env:|soapenv:|S:)?Fault>/);
	if (!fault) return null;
	const codeMatch = fault[0].match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/);
	const msgMatch = fault[0].match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
	return {
		code: codeMatch ? codeMatch[1].trim() : "soap:Fault",
		message: msgMatch ? msgMatch[1].trim() : "Unknown SOAP fault",
	};
}

async function postSoap(url: string, envelope: string): Promise<string> {
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
		body: envelope,
	});
	const body = await resp.text();
	if (!resp.ok) {
		const fault = extractFault(body);
		throw new Error(`SUNAT HTTP ${resp.status}: ${fault ? `${fault.code} — ${fault.message}` : body.slice(0, 500)}`);
	}
	const fault = extractFault(body);
	if (fault) throw new Error(`SUNAT SOAP Fault: ${fault.code} — ${fault.message}`);
	return body;
}

export async function sendBill(args: SendBillArgs): Promise<SendBillResult> {
	const zipBuffer = await zipSingleFile(`${args.filename}.xml`, args.xml);
	const zipBase64 = zipBuffer.toString("base64");
	const envelope = buildSendBillEnvelope({
		username: args.wsUsername,
		password: args.wsPassword,
		filename: args.filename,
		zipBase64,
	});

	const body = await postSoap(SUNAT_ENDPOINTS_FAC[args.mode], envelope);
	const appResponseB64 = extractApplicationResponseBase64(body);
	if (!appResponseB64) {
		throw new Error(`SUNAT response did not contain applicationResponse. Body: ${body.slice(0, 500)}`);
	}

	const cdrZipBuffer = Buffer.from(appResponseB64, "base64");
	const { xml: cdrXml } = await unzipNested(cdrZipBuffer);
	const cdr = parseCdr(cdrXml);

	return { cdr, cdrZipBase64: appResponseB64, httpStatus: 200 };
}

export interface SendSummaryArgs {
	mode: SunatMode;
	wsUsername: string;
	wsPassword: string;
	xml: string;
	filename: string;
}

export interface SendSummaryResult {
	ticket: string;
}

export async function sendSummary(args: SendSummaryArgs): Promise<SendSummaryResult> {
	const zipBuffer = await zipSingleFile(`${args.filename}.xml`, args.xml);
	const zipBase64 = zipBuffer.toString("base64");
	const envelope = buildSendSummaryEnvelope({
		username: args.wsUsername,
		password: args.wsPassword,
		filename: args.filename,
		zipBase64,
	});
	const body = await postSoap(SUNAT_ENDPOINTS_FAC[args.mode], envelope);
	const ticket = extractTicket(body);
	if (!ticket) throw new Error(`SUNAT sendSummary did not return a ticket. Body: ${body.slice(0, 500)}`);
	return { ticket };
}

export type GetStatusOutcome =
	| { state: "processing"; statusCode: string }
	| { state: "completed"; statusCode: string; cdr: CdrResponse; cdrZipBase64: string }
	| { state: "rejected"; statusCode: string; cdr: CdrResponse; cdrZipBase64: string };

export interface GetStatusArgs {
	mode: SunatMode;
	wsUsername: string;
	wsPassword: string;
	ticket: string;
}

/**
 * Single getStatus call. Returns:
 *  - state="processing" when SUNAT is still working (statusCode 98)
 *  - state="completed" when accepted (statusCode 0) — cdr present
 *  - state="rejected" when SUNAT rejected the summary (statusCode 99) — cdr present with errors
 */
export async function getStatus(args: GetStatusArgs): Promise<GetStatusOutcome> {
	const envelope = buildGetStatusEnvelope({ username: args.wsUsername, password: args.wsPassword, ticket: args.ticket });
	const body = await postSoap(SUNAT_ENDPOINTS_FAC[args.mode], envelope);
	const statusCode = extractStatusCode(body) || "";
	const content = extractStatusContent(body);

	// 98 = en proceso, 0 = aceptado con CDR, 99 = rechazado con CDR de errores
	if (statusCode === "98" || !content) {
		return { state: "processing", statusCode };
	}

	const cdrZipBuffer = Buffer.from(content, "base64");
	const { xml: cdrXml } = await unzipNested(cdrZipBuffer);
	const cdr = parseCdr(cdrXml);
	const accepted = statusCode === "0" && cdr.accepted;
	return {
		state: accepted ? "completed" : "rejected",
		statusCode,
		cdr,
		cdrZipBase64: content,
	};
}

export interface PollStatusOptions {
	mode: SunatMode;
	wsUsername: string;
	wsPassword: string;
	ticket: string;
	timeoutMs?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	onTick?: (attempt: number, state: string) => void;
}

/**
 * Poll getStatus with exponential backoff until completed/rejected or timeout.
 * Default schedule: 2s, 4s, 8s, 16s, 30s, 30s, ... up to 5min total.
 */
export async function pollStatus(opts: PollStatusOptions): Promise<GetStatusOutcome> {
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	const initialDelayMs = opts.initialDelayMs ?? 2000;
	const maxDelayMs = opts.maxDelayMs ?? 30_000;
	const start = Date.now();
	let delay = initialDelayMs;
	let attempt = 0;

	while (Date.now() - start < timeoutMs) {
		attempt += 1;
		const outcome = await getStatus({ mode: opts.mode, wsUsername: opts.wsUsername, wsPassword: opts.wsPassword, ticket: opts.ticket });
		opts.onTick?.(attempt, outcome.state);
		if (outcome.state !== "processing") return outcome;
		await sleep(delay);
		delay = Math.min(delay * 2, maxDelayMs);
	}

	throw new Error(`SUNAT getStatus timeout after ${Math.round((Date.now() - start) / 1000)}s for ticket ${opts.ticket}`);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
