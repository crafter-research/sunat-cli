/**
 * UBL 2.1 Nota de Débito Electrónica builder for SUNAT (CPE tipo 08).
 *
 * Differences vs Nota de Crédito:
 *   - Root: <DebitNote> (NS DebitNote-2)
 *   - Line: <DebitNoteLine> with <DebitedQuantity>
 *   - Totales: <RequestedMonetaryTotal> instead of <LegalMonetaryTotal>
 *   - tipoNota uses Catalog 10 (Tipo de nota de débito) instead of Catalog 09
 *   - Filename: {RUC}-08-{serie}-{numero}
 *
 * Common with NC: DiscrepancyResponse + BillingReference pointing to the
 * affected Factura/Boleta. Same emisor/receptor blocks. Same line shape
 * apart from the wrapper tags.
 */

import type { NotaDebitoInput } from "../drivers/types.ts";
import {
	type EmisorCtx,
	escapeXml,
	renderCacSignature,
	renderEmisorParty,
	renderReceptorParty,
	renderInvoiceLine,
	fmt,
} from "./common.ts";

export interface NotaDebitoContext {
	emisor: EmisorCtx;
}

const ND_NS = {
	xmlns: "urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2",
	cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
	cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
	ds: "http://www.w3.org/2000/09/xmldsig#",
	ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
} as const;

export function notaDebitoFilename(emisorRuc: string, serie: string, numero: number): string {
	return `${emisorRuc}-08-${serie}-${numero}`;
}

function renderDebitNoteLine(item: NotaDebitoInput["items"][number], idx: number, moneda: string): string {
	const invoiceLineXml = renderInvoiceLine(item, idx, moneda);
	return invoiceLineXml
		.replace(/<cac:InvoiceLine>/g, "<cac:DebitNoteLine>")
		.replace(/<\/cac:InvoiceLine>/g, "</cac:DebitNoteLine>")
		.replace(/<cbc:InvoicedQuantity/g, "<cbc:DebitedQuantity")
		.replace(/<\/cbc:InvoicedQuantity>/g, "</cbc:DebitedQuantity>");
}

function tipDocAfectadoFromSerie(serie: string): "01" | "03" {
	if (serie.startsWith("B")) return "03";
	return "01";
}

/**
 * ND uses RequestedMonetaryTotal, NOT LegalMonetaryTotal. We keep the
 * TaxTotal block identical to NC/Factura but rebuild the totals block.
 */
function renderTaxAndTotalsND(totales: { valorVenta: number; igv: number; total: number }, moneda: string): string {
	const totalIgv = totales.igv;
	const totalValor = totales.valorVenta;
	const totalPagar = totales.total;
	return `    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${moneda}">${fmt(totalIgv)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${moneda}">${fmt(totalValor)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${moneda}">${fmt(totalIgv)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cac:TaxScheme>
                    <cbc:ID schemeName="Codigo de tributos" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo05">1000</cbc:ID>
                    <cbc:Name>IGV</cbc:Name>
                    <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:RequestedMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${moneda}">${fmt(totalValor)}</cbc:LineExtensionAmount>
        <cbc:TaxInclusiveAmount currencyID="${moneda}">${fmt(totalPagar)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${moneda}">${fmt(totalPagar)}</cbc:PayableAmount>
    </cac:RequestedMonetaryTotal>`;
}

export function buildNotaDebitoUbl(input: NotaDebitoInput, ctx: NotaDebitoContext): string {
	const { emisor } = ctx;
	const id = `${input.serie}-${input.numero}`;
	const lines = input.items.map((item, idx) => renderDebitNoteLine(item, idx, input.moneda)).join("\n");

	const refSerieNumero = `${input.refSerie}-${input.refNumero}`;
	const tipDocAfectado = tipDocAfectadoFromSerie(input.refSerie);

	return `<?xml version="1.0" encoding="UTF-8"?>
<DebitNote xmlns="${ND_NS.xmlns}" xmlns:cac="${ND_NS.cac}" xmlns:cbc="${ND_NS.cbc}" xmlns:ds="${ND_NS.ds}" xmlns:ext="${ND_NS.ext}">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent/>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
    <cbc:CustomizationID>2.0</cbc:CustomizationID>
    <cbc:ID>${escapeXml(id)}</cbc:ID>
    <cbc:IssueDate>${input.fechaEmision}</cbc:IssueDate>
    <cbc:DocumentCurrencyCode>${input.moneda}</cbc:DocumentCurrencyCode>
    <cac:DiscrepancyResponse>
        <cbc:ReferenceID>${escapeXml(refSerieNumero)}</cbc:ReferenceID>
        <cbc:ResponseCode>${escapeXml(input.tipoNota)}</cbc:ResponseCode>
        <cbc:Description><![CDATA[${input.motivo}]]></cbc:Description>
    </cac:DiscrepancyResponse>
    <cac:BillingReference>
        <cac:InvoiceDocumentReference>
            <cbc:ID>${escapeXml(refSerieNumero)}</cbc:ID>
            <cbc:DocumentTypeCode>${tipDocAfectado}</cbc:DocumentTypeCode>
        </cac:InvoiceDocumentReference>
    </cac:BillingReference>
${renderCacSignature(emisor)}
${renderEmisorParty(emisor)}
${renderReceptorParty(input.receptor)}
${renderTaxAndTotalsND(input.totales, input.moneda)}
${lines}
</DebitNote>`;
}
