/**
 * Shared UBL 2.1 building blocks for SUNAT CPE documents.
 * Used by factura.ts and boleta.ts (Invoice schema), and partly by resumen.ts.
 */

import { round2 } from "../validation/reglas.ts";

export interface EmisorCtx {
	ruc: string;
	razonSocial: string;
	nombreComercial?: string;
	ubigeo?: string;
	direccion?: string;
	codigoPais?: string;
}

export const NS = {
	xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
	cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
	cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
	ds: "http://www.w3.org/2000/09/xmldsig#",
	ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
} as const;

export function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function fmt(n: number): string {
	return round2(n).toFixed(2);
}

export function fmtQty(n: number): string {
	const decimals = (n.toString().split(".")[1] || "").length;
	return n.toFixed(Math.min(10, Math.max(2, decimals)));
}

export interface InvoiceLineInput {
	codigo: string;
	descripcion: string;
	cantidad: number;
	unidad: string;
	valorUnitario: number;
	igvPct: number;
}

export function renderInvoiceLine(item: InvoiceLineInput, idx: number, moneda: string): string {
	const lineSubtotal = round2(item.cantidad * item.valorUnitario);
	const lineIgv = round2(lineSubtotal * (item.igvPct / 100));
	const valorUnitConIgv = round2(item.valorUnitario * (1 + item.igvPct / 100));
	const igvAffectation = item.igvPct > 0 ? "10" : "20"; // 10=Gravado IGV, 20=Exonerado

	return `        <cac:InvoiceLine>
            <cbc:ID>${idx + 1}</cbc:ID>
            <cbc:InvoicedQuantity unitCode="${escapeXml(item.unidad || "NIU")}">${fmtQty(item.cantidad)}</cbc:InvoicedQuantity>
            <cbc:LineExtensionAmount currencyID="${moneda}">${fmt(lineSubtotal)}</cbc:LineExtensionAmount>
            <cac:PricingReference>
                <cac:AlternativeConditionPrice>
                    <cbc:PriceAmount currencyID="${moneda}">${fmt(valorUnitConIgv)}</cbc:PriceAmount>
                    <cbc:PriceTypeCode listName="Tipo de Precio" listAgencyName="PE:SUNAT" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16">01</cbc:PriceTypeCode>
                </cac:AlternativeConditionPrice>
            </cac:PricingReference>
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID="${moneda}">${fmt(lineIgv)}</cbc:TaxAmount>
                <cac:TaxSubtotal>
                    <cbc:TaxableAmount currencyID="${moneda}">${fmt(lineSubtotal)}</cbc:TaxableAmount>
                    <cbc:TaxAmount currencyID="${moneda}">${fmt(lineIgv)}</cbc:TaxAmount>
                    <cac:TaxCategory>
                        <cbc:Percent>${item.igvPct.toFixed(2)}</cbc:Percent>
                        <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="Afectacion del IGV" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07">${igvAffectation}</cbc:TaxExemptionReasonCode>
                        <cac:TaxScheme>
                            <cbc:ID schemeName="Codigo de tributos" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo05">1000</cbc:ID>
                            <cbc:Name>IGV</cbc:Name>
                            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
                        </cac:TaxScheme>
                    </cac:TaxCategory>
                </cac:TaxSubtotal>
            </cac:TaxTotal>
            <cac:Item>
                <cbc:Description><![CDATA[${item.descripcion}]]></cbc:Description>
                <cac:SellersItemIdentification>
                    <cbc:ID>${escapeXml(item.codigo)}</cbc:ID>
                </cac:SellersItemIdentification>
            </cac:Item>
            <cac:Price>
                <cbc:PriceAmount currencyID="${moneda}">${fmt(item.valorUnitario)}</cbc:PriceAmount>
            </cac:Price>
        </cac:InvoiceLine>`;
}

export function renderEmisorParty(emisor: EmisorCtx): string {
	return `    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${emisor.ruc}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyName>
                <cbc:Name><![CDATA[${emisor.nombreComercial || emisor.razonSocial}]]></cbc:Name>
            </cac:PartyName>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${emisor.razonSocial}]]></cbc:RegistrationName>
                <cac:RegistrationAddress>
                    <cbc:ID>${escapeXml(emisor.ubigeo || "150101")}</cbc:ID>
                    <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
                    <cac:AddressLine>
                        <cbc:Line><![CDATA[${emisor.direccion || "-"}]]></cbc:Line>
                    </cac:AddressLine>
                    <cac:Country>
                        <cbc:IdentificationCode>${escapeXml(emisor.codigoPais || "PE")}</cbc:IdentificationCode>
                    </cac:Country>
                </cac:RegistrationAddress>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>`;
}

export interface ReceptorRender {
	tipoDoc: string;
	numDoc: string;
	rznSocial: string;
	direccion?: string;
}

export function renderReceptorParty(receptor: ReceptorRender): string {
	return `    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="${receptor.tipoDoc}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapeXml(receptor.numDoc)}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${receptor.rznSocial}]]></cbc:RegistrationName>
                ${receptor.direccion ? `<cac:RegistrationAddress><cac:AddressLine><cbc:Line><![CDATA[${receptor.direccion}]]></cbc:Line></cac:AddressLine></cac:RegistrationAddress>` : ""}
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>`;
}

export function renderCacSignature(emisor: EmisorCtx): string {
	return `    <cac:Signature>
        <cbc:ID>${emisor.ruc}</cbc:ID>
        <cac:SignatoryParty>
            <cac:PartyIdentification>
                <cbc:ID>${emisor.ruc}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyName>
                <cbc:Name><![CDATA[${emisor.razonSocial}]]></cbc:Name>
            </cac:PartyName>
        </cac:SignatoryParty>
        <cac:DigitalSignatureAttachment>
            <cac:ExternalReference>
                <cbc:URI>#SignatureSP</cbc:URI>
            </cac:ExternalReference>
        </cac:DigitalSignatureAttachment>
    </cac:Signature>`;
}

export function renderTaxAndTotals(totales: { valorVenta: number; igv: number; total: number }, moneda: string): string {
	const totalIgv = round2(totales.igv);
	const totalValor = round2(totales.valorVenta);
	const totalPagar = round2(totales.total);

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
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${moneda}">${fmt(totalValor)}</cbc:LineExtensionAmount>
        <cbc:TaxInclusiveAmount currencyID="${moneda}">${fmt(totalPagar)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${moneda}">${fmt(totalPagar)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>`;
}
