/**
 * Parse SUNAT CDR (Constancia de Recepcion) XML response.
 *
 * SUNAT returns a CDR XML wrapped in two ZIPs (see ./zip.ts). The CDR contains:
 * - ResponseCode: 0=Aceptado, 0001-0099=Aceptado con observaciones, 2xxx-3xxx=Rechazado, 4xxx+=Excepcion
 * - Description: human-readable status
 * - Notes: warnings (when accepted with observations)
 */

import { XMLParser } from "fast-xml-parser";

export interface CdrResponse {
	responseCode: string;
	description: string;
	referenceId?: string;
	notes: string[];
	rawXml: string;
	accepted: boolean;
}

export function parseCdr(xml: string): CdrResponse {
	const parser = new XMLParser({
		ignoreAttributes: false,
		removeNSPrefix: true,
		isArray: (name) => name === "Note",
	});
	const parsed = parser.parse(xml) as Record<string, unknown>;
	const root = (parsed.ApplicationResponse || parsed["ar:ApplicationResponse"] || parsed) as Record<string, unknown>;

	const docResponse = (root.DocumentResponse || (root as Record<string, unknown>).Response) as
		| Record<string, unknown>
		| undefined;
	const response = (docResponse?.Response || docResponse) as Record<string, unknown> | undefined;

	const responseCode = String(response?.ResponseCode ?? "");
	const description = String(response?.Description ?? "");
	const referenceId = response?.ReferenceID as string | undefined;
	const rawNotes = response?.Note as string[] | string | undefined;
	const notes = rawNotes ? (Array.isArray(rawNotes) ? rawNotes : [rawNotes]).map(String) : [];
	const numeric = Number.parseInt(responseCode, 10);
	const accepted = !Number.isNaN(numeric) && numeric < 2000;

	return { responseCode, description, referenceId, notes, rawXml: xml, accepted };
}
