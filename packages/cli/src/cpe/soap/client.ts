/**
 * SOAP client for SUNAT BillService.sendBill (sync, returns CDR ZIP).
 *
 * Auth: WS-Security UsernameToken with RUC + SOL_USER as username, SOL_PASSWORD as password.
 * Endpoints (FAC/BOL/NCR/NDB):
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

function extractApplicationResponseBase64(soapXml: string): string | null {
	const match = soapXml.match(/<applicationResponse[^>]*>([\s\S]*?)<\/applicationResponse>/);
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

export async function sendBill(args: SendBillArgs): Promise<SendBillResult> {
	const zipBuffer = await zipSingleFile(`${args.filename}.xml`, args.xml);
	const zipBase64 = zipBuffer.toString("base64");
	const envelope = buildSendBillEnvelope({
		username: args.wsUsername,
		password: args.wsPassword,
		filename: args.filename,
		zipBase64,
	});

	const url = SUNAT_ENDPOINTS_FAC[args.mode];
	const resp = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "text/xml; charset=utf-8",
			SOAPAction: '""',
		},
		body: envelope,
	});

	const body = await resp.text();
	if (!resp.ok) {
		const fault = extractFault(body);
		throw new Error(`SUNAT HTTP ${resp.status}: ${fault ? `${fault.code} — ${fault.message}` : body.slice(0, 500)}`);
	}

	const fault = extractFault(body);
	if (fault) {
		throw new Error(`SUNAT SOAP Fault: ${fault.code} — ${fault.message}`);
	}

	const appResponseB64 = extractApplicationResponseBase64(body);
	if (!appResponseB64) {
		throw new Error(`SUNAT response did not contain applicationResponse. Body: ${body.slice(0, 500)}`);
	}

	const cdrZipBuffer = Buffer.from(appResponseB64, "base64");
	const { xml: cdrXml } = await unzipNested(cdrZipBuffer);
	const cdr = parseCdr(cdrXml);

	return { cdr, cdrZipBase64: appResponseB64, httpStatus: resp.status };
}
