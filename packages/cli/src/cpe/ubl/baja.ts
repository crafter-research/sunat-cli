/**
 * UBL 2.0 Comunicacion de Baja builder for SUNAT.
 *
 * Used to anular previously emitted documents (typically boletas, but also
 * facturas/NCs/NDs in certain cases). Sent via sendSummary (async, returns
 * ticket); same polling flow as resumen.
 *
 * Plazo: 7 calendar days from fechaEmision of the document being voided.
 *
 * References:
 *   - https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+comunicacion+baja+version+2-0+1+0_0.pdf
 *   - Greenter twig: https://github.com/thegreenter/greenter/blob/master/packages/xml/src/Xml/Templates/voided.xml.twig
 */

import { type EmisorCtx, escapeXml, renderCacSignature } from "./common.ts";

export const VOIDED_NS = {
	xmlns: "urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1",
	cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
	cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
	ds: "http://www.w3.org/2000/09/xmldsig#",
	ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
	sac: "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1",
} as const;

export interface BajaEntry {
	tipoDoc: "01" | "03" | "07" | "08";
	serie: string;
	numero: number;
	motivo: string;
}

export interface BajaInput {
	fechaEmisionDocs: string; // YYYY-MM-DD — fecha de emision de los documentos a anular
	fechaComunicacion: string; // YYYY-MM-DD — fecha de envio (today)
	correlativo: number;
	entries: BajaEntry[];
}

export interface BajaContext {
	emisor: EmisorCtx;
}

export function bajaFilenameRA(emisorRuc: string, fechaComunicacion: string, correlativo: number): string {
	const ymd = fechaComunicacion.replace(/-/g, "");
	return `${emisorRuc}-RA-${ymd}-${correlativo}`;
}

function renderVoidedLine(entry: BajaEntry, idx: number): string {
	return `        <sac:VoidedDocumentsLine>
            <cbc:LineID>${idx + 1}</cbc:LineID>
            <cbc:DocumentTypeCode>${entry.tipoDoc}</cbc:DocumentTypeCode>
            <sac:DocumentSerialID>${escapeXml(entry.serie)}</sac:DocumentSerialID>
            <sac:DocumentNumberID>${entry.numero}</sac:DocumentNumberID>
            <sac:VoidReasonDescription><![CDATA[${entry.motivo}]]></sac:VoidReasonDescription>
        </sac:VoidedDocumentsLine>`;
}

export function buildBajaUbl(input: BajaInput, ctx: BajaContext): string {
	const { emisor } = ctx;
	const id = `RA-${input.fechaComunicacion.replace(/-/g, "")}-${input.correlativo}`;
	const lines = input.entries.map((entry, idx) => renderVoidedLine(entry, idx)).join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<VoidedDocuments xmlns="${VOIDED_NS.xmlns}" xmlns:cac="${VOIDED_NS.cac}" xmlns:cbc="${VOIDED_NS.cbc}" xmlns:ds="${VOIDED_NS.ds}" xmlns:ext="${VOIDED_NS.ext}" xmlns:sac="${VOIDED_NS.sac}">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent/>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
    <cbc:CustomizationID>1.0</cbc:CustomizationID>
    <cbc:ID>${id}</cbc:ID>
    <cbc:ReferenceDate>${input.fechaEmisionDocs}</cbc:ReferenceDate>
    <cbc:IssueDate>${input.fechaComunicacion}</cbc:IssueDate>
${renderCacSignature(emisor)}
    <cac:AccountingSupplierParty>
        <cbc:CustomerAssignedAccountID>${emisor.ruc}</cbc:CustomerAssignedAccountID>
        <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
        <cac:Party>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${emisor.razonSocial}]]></cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>
${lines}
</VoidedDocuments>`;
}
