/**
 * UBL 2.1 Factura Electronica builder for SUNAT.
 *
 * Renders a minimal but SUNAT-compliant Invoice XML for tipoDoc=01 (Factura).
 * Includes the required ext:UBLExtensions placeholder so the XAdES-BES signer
 * can fill in the signature node afterwards.
 *
 * References:
 * - https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+factura+version+2-1+1+0%20(2)_0%20(2).pdf
 * - https://github.com/thegreenter/greenter (PHP reference impl)
 */

import type { FacturaInput } from "../drivers/types.ts";
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

export interface FacturaContext {
	emisor: EmisorCtx;
}

export function facturaFilename(emisorRuc: string, serie: string, numero: number): string {
	return `${emisorRuc}-01-${serie}-${numero}`;
}

export function buildFacturaUbl(input: FacturaInput, ctx: FacturaContext): string {
	const { emisor } = ctx;
	const id = `${input.serie}-${input.numero}`;
	const lines = input.items.map((item, idx) => renderInvoiceLine(item, idx, input.moneda)).join("\n");

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
    <cbc:InvoiceTypeCode listID="0101" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">01</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${input.moneda}</cbc:DocumentCurrencyCode>
${renderCacSignature(emisor)}
${renderEmisorParty(emisor)}
${renderReceptorParty(input.receptor)}
    <cac:PaymentTerms>
        <cbc:ID>FormaPago</cbc:ID>
        <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
    </cac:PaymentTerms>
${renderTaxAndTotals(input.totales, input.moneda)}
${lines}
</Invoice>`;
}
