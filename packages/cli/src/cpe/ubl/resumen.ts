/**
 * UBL 2.0 Resumen Diario de Boletas builder for SUNAT.
 *
 * Schema: SummaryDocuments-1 (NOT Invoice-2). Used to ship a batch of boletas
 * (and associated NCs/NDs of boletas) issued the same day.
 *
 * SUNAT processes asynchronously: sendSummary returns a ticket; you poll
 * getStatus until CDR comes back.
 *
 * References:
 *   - https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+resumen+version+2-0+1+0_0_0%20(2).pdf
 */

import { round2 } from "../validation/reglas.ts";
import { type EmisorCtx, escapeXml, fmt, renderCacSignature } from "./common.ts";

export const SUMMARY_NS = {
	xmlns: "urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1",
	cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
	cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
	ds: "http://www.w3.org/2000/09/xmldsig#",
	ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
	sac: "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1",
} as const;

export type SummaryEntryStatus = "1" | "2" | "3";
// 1=adicionar, 2=modificar, 3=anular

export interface SummaryBoletaEntry {
	tipoDoc: "03" | "07" | "08";
	serie: string;
	numero: number;
	receptor?: { tipoDoc: string; numDoc: string };
	totales: { valorVenta: number; igv: number; total: number };
	moneda: "PEN" | "USD";
	status?: SummaryEntryStatus;
}

export interface ResumenInput {
	fechaEmisionBoletas: string; // YYYY-MM-DD — fecha de emision de las boletas (NOT today)
	fechaResumen: string; // YYYY-MM-DD — fecha de envio del resumen (today usually)
	correlativo: number; // 1..N within the same fechaResumen day
	entries: SummaryBoletaEntry[];
}

export interface ResumenContext {
	emisor: EmisorCtx;
}

/**
 * Filename: {RUC}-RC-{YYYYMMDD}-{N} where YYYYMMDD = fechaResumen and N = correlativo.
 */
export function resumenFilename(emisorRuc: string, fechaResumen: string, correlativo: number): string {
	const ymd = fechaResumen.replace(/-/g, "");
	return `${emisorRuc}-RC-${ymd}-${correlativo}`;
}

/**
 * Filename for Comunicacion de Baja: {RUC}-RA-{YYYYMMDD}-{N}.
 */
export function bajaFilename(emisorRuc: string, fechaResumen: string, correlativo: number): string {
	const ymd = fechaResumen.replace(/-/g, "");
	return `${emisorRuc}-RA-${ymd}-${correlativo}`;
}

function renderSummaryLine(entry: SummaryBoletaEntry, idx: number): string {
	const status = entry.status || "1";
	const igv = round2(entry.totales.igv);
	const valorVenta = round2(entry.totales.valorVenta);
	const total = round2(entry.totales.total);
	// SUNAT element order (per Greenter twig + SUNAT XSD):
	// LineID, DocumentTypeCode, ID, AccountingCustomerParty, [BillingReference],
	// cac:Status, sac:TotalAmount, sac:BillingPayment*, cac:TaxTotal+
	const receptorBlock = entry.receptor && entry.receptor.numDoc
		? `            <cac:AccountingCustomerParty>
                <cbc:CustomerAssignedAccountID>${escapeXml(entry.receptor.numDoc)}</cbc:CustomerAssignedAccountID>
                <cbc:AdditionalAccountID>${escapeXml(entry.receptor.tipoDoc)}</cbc:AdditionalAccountID>
            </cac:AccountingCustomerParty>`
		: "";

	return `        <sac:SummaryDocumentsLine>
            <cbc:LineID>${idx + 1}</cbc:LineID>
            <cbc:DocumentTypeCode>${entry.tipoDoc}</cbc:DocumentTypeCode>
            <cbc:ID>${entry.serie}-${entry.numero}</cbc:ID>
${receptorBlock}
            <cac:Status>
                <cbc:ConditionCode>${status}</cbc:ConditionCode>
            </cac:Status>
            <sac:TotalAmount currencyID="${entry.moneda}">${fmt(total)}</sac:TotalAmount>
            <sac:BillingPayment>
                <cbc:PaidAmount currencyID="${entry.moneda}">${fmt(valorVenta)}</cbc:PaidAmount>
                <cbc:InstructionID>01</cbc:InstructionID>
            </sac:BillingPayment>
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID="${entry.moneda}">${fmt(igv)}</cbc:TaxAmount>
                <cac:TaxSubtotal>
                    <cbc:TaxAmount currencyID="${entry.moneda}">${fmt(igv)}</cbc:TaxAmount>
                    <cac:TaxCategory>
                        <cbc:Percent>18.00</cbc:Percent>
                        <cac:TaxScheme>
                            <cbc:ID>1000</cbc:ID>
                            <cbc:Name>IGV</cbc:Name>
                            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
                        </cac:TaxScheme>
                    </cac:TaxCategory>
                </cac:TaxSubtotal>
            </cac:TaxTotal>
        </sac:SummaryDocumentsLine>`;
}

export function buildResumenUbl(input: ResumenInput, ctx: ResumenContext): string {
	const { emisor } = ctx;
	const id = `RC-${input.fechaResumen.replace(/-/g, "")}-${input.correlativo}`;
	const lines = input.entries.map((entry, idx) => renderSummaryLine(entry, idx)).join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<SummaryDocuments xmlns="${SUMMARY_NS.xmlns}" xmlns:cac="${SUMMARY_NS.cac}" xmlns:cbc="${SUMMARY_NS.cbc}" xmlns:ds="${SUMMARY_NS.ds}" xmlns:ext="${SUMMARY_NS.ext}" xmlns:sac="${SUMMARY_NS.sac}">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent/>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
    <cbc:CustomizationID>1.1</cbc:CustomizationID>
    <cbc:ID>${id}</cbc:ID>
    <cbc:ReferenceDate>${input.fechaEmisionBoletas}</cbc:ReferenceDate>
    <cbc:IssueDate>${input.fechaResumen}</cbc:IssueDate>
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
</SummaryDocuments>`;
}
