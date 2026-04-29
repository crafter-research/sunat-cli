/**
 * UBL 2.1 Boleta de Venta Electronica builder for SUNAT.
 *
 * Renders a SUNAT-compliant Invoice XML for tipoDoc=03 (Boleta).
 *
 * Differences vs Factura:
 *   - InvoiceTypeCode = "03" (instead of "01")
 *   - Serie starts with "B" (e.g. B001) instead of "F"
 *   - Receptor optional when total < S/700 (uses DNI 00000000 + "Cliente Varios")
 *   - Boletas are normally sent in a daily summary (sendSummary), NOT individually,
 *     EXCEPT when total >= S/700 — then they go via sendBill like a factura.
 *
 * References:
 *   - https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+boleta+version+2-1+1+0_1.pdf
 */

import type { BoletaInput } from "../drivers/types.ts";
import {
	type EmisorCtx,
	NS,
	escapeXml,
	renderCacSignature,
	renderEmisorParty,
	renderInvoiceLine,
	renderReceptorParty,
	renderTaxAndTotals,
} from "./common.ts";

export interface BoletaContext {
	emisor: EmisorCtx;
}

export const BOLETA_RECEPTOR_REQUIRED_THRESHOLD = 700;

export function boletaFilename(emisorRuc: string, serie: string, numero: number): string {
	return `${emisorRuc}-03-${serie}-${numero}`;
}

/**
 * Returns true when the boleta is high enough that SUNAT requires a real
 * receptor and the document MUST be sent individually via sendBill.
 */
export function boletaRequiresReceptor(totalPagar: number): boolean {
	return totalPagar >= BOLETA_RECEPTOR_REQUIRED_THRESHOLD;
}

/**
 * Returns true when the boleta is high enough that SUNAT requires individual
 * (sync) submission via sendBill instead of daily summary (sendSummary).
 */
export function boletaRequiresIndividualSubmission(totalPagar: number): boolean {
	return totalPagar >= BOLETA_RECEPTOR_REQUIRED_THRESHOLD;
}

function defaultReceptor(): { tipoDoc: string; numDoc: string; rznSocial: string } {
	return { tipoDoc: "1", numDoc: "00000000", rznSocial: "Cliente Varios" };
}

export function buildBoletaUbl(input: BoletaInput, ctx: BoletaContext): string {
	const { emisor } = ctx;
	const id = `${input.serie}-${input.numero}`;
	const lines = input.items.map((item, idx) => renderInvoiceLine(item, idx, input.moneda)).join("\n");

	const receptorIn = input.receptor && input.receptor.numDoc ? input.receptor : (defaultReceptor() as BoletaInput["receptor"]);

	return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="${NS.xmlns}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent/>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
    <cbc:CustomizationID>2.0</cbc:CustomizationID>
    <cbc:ProfileID schemeName="SUNAT:Identificador de Tipo de Operacion" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo51">0101</cbc:ProfileID>
    <cbc:ID>${escapeXml(id)}</cbc:ID>
    <cbc:IssueDate>${input.fechaEmision}</cbc:IssueDate>
    <cbc:InvoiceTypeCode listID="0101" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">03</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${input.moneda}</cbc:DocumentCurrencyCode>
${renderCacSignature(emisor)}
${renderEmisorParty(emisor)}
${renderReceptorParty(receptorIn)}
    <cac:PaymentTerms>
        <cbc:ID>FormaPago</cbc:ID>
        <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
    </cac:PaymentTerms>
${renderTaxAndTotals(input.totales, input.moneda)}
${lines}
</Invoice>`;
}
