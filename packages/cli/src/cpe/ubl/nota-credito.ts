/**
 * UBL 2.1 Nota de Crédito Electrónica builder for SUNAT (CPE tipo 07).
 *
 * Differences vs Factura:
 *   - Root: <CreditNote> (NS CreditNote-2)
 *   - Line: <CreditNoteLine> with <CreditedQuantity> instead of InvoicedQuantity
 *   - Adds <cac:DiscrepancyResponse> with motivo (Catálogo 09)
 *   - Adds <cac:BillingReference> pointing to the original Factura/Boleta
 *   - Serie: FXNN (when relating to a Factura) or BXNN (when relating to a Boleta)
 *   - Filename: {RUC}-07-{serie}-{numero}
 *   - InvoiceTypeCode replaced by absence (CreditNote root implies tipo 07)
 *
 * References:
 *   - https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+nota%20de%20cr%C3%A9dito+version+2-1+1+0_0_0%20(2).pdf
 *   - Greenter notacr2.1.xml.twig
 */

import type { NotaCreditoInput } from "../drivers/types.ts";
import {
	type EmisorCtx,
	escapeXml,
	renderCacSignature,
	renderEmisorParty,
	renderReceptorParty,
	renderTaxAndTotals,
	renderInvoiceLine,
} from "./common.ts";

export interface NotaContext {
	emisor: EmisorCtx;
}

const NC_NS = {
	xmlns: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
	cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
	cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
	ds: "http://www.w3.org/2000/09/xmldsig#",
	ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
} as const;

export function notaCreditoFilename(emisorRuc: string, serie: string, numero: number): string {
	return `${emisorRuc}-07-${serie}-${numero}`;
}

/**
 * Render a CreditNoteLine.
 *
 * The factura's renderInvoiceLine returns "<cac:InvoiceLine>...<InvoicedQuantity>...</InvoiceLine>".
 * We post-process its output to swap the wrapper tag + quantity tag, then keep
 * everything else (PricingReference, TaxTotal, Item, Price) identical — they
 * are valid in the CreditNote schema unchanged.
 */
function renderCreditNoteLine(item: NotaCreditoInput["items"][number], idx: number, moneda: string): string {
	const invoiceLineXml = renderInvoiceLine(item, idx, moneda);
	return invoiceLineXml
		.replace(/<cac:InvoiceLine>/g, "<cac:CreditNoteLine>")
		.replace(/<\/cac:InvoiceLine>/g, "</cac:CreditNoteLine>")
		.replace(/<cbc:InvoicedQuantity/g, "<cbc:CreditedQuantity")
		.replace(/<\/cbc:InvoicedQuantity>/g, "</cbc:CreditedQuantity>");
}

/**
 * Detect the SUNAT document type code of the affected document from the serie.
 * F* → 01 (Factura), B* → 03 (Boleta).
 */
function tipDocAfectadoFromSerie(serie: string): "01" | "03" {
	if (serie.startsWith("B")) return "03";
	return "01";
}

export function buildNotaCreditoUbl(input: NotaCreditoInput, ctx: NotaContext): string {
	const { emisor } = ctx;
	const id = `${input.serie}-${input.numero}`;
	const lines = input.items.map((item, idx) => renderCreditNoteLine(item, idx, input.moneda)).join("\n");

	const refSerieNumero = `${input.refSerie}-${input.refNumero}`;
	const tipDocAfectado = tipDocAfectadoFromSerie(input.refSerie);

	return `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="${NC_NS.xmlns}" xmlns:cac="${NC_NS.cac}" xmlns:cbc="${NC_NS.cbc}" xmlns:ds="${NC_NS.ds}" xmlns:ext="${NC_NS.ext}">
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
${renderTaxAndTotals(input.totales, input.moneda)}
${lines}
</CreditNote>`;
}
