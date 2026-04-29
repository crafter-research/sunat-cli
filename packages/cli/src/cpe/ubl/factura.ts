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
import { round2 } from "../validation/reglas.ts";

export interface FacturaContext {
	emisor: {
		ruc: string;
		razonSocial: string;
		nombreComercial?: string;
		ubigeo?: string;
		direccion?: string;
		codigoPais?: string;
	};
}

const NS = {
	xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
	cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
	cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
	ds: "http://www.w3.org/2000/09/xmldsig#",
	ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
};

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function fmt(n: number): string {
	return round2(n).toFixed(2);
}

function fmtQty(n: number): string {
	return n.toFixed(Math.min(10, Math.max(2, (n.toString().split(".")[1] || "").length)));
}

export function facturaFilename(emisorRuc: string, serie: string, numero: number): string {
	return `${emisorRuc}-01-${serie}-${numero}`;
}

export function buildFacturaUbl(input: FacturaInput, ctx: FacturaContext): string {
	const { emisor } = ctx;
	const id = `${input.serie}-${input.numero}`;
	const totalIgv = round2(input.totales.igv);
	const totalValor = round2(input.totales.valorVenta);
	const totalPagar = round2(input.totales.total);

	const lines = input.items
		.map((item, idx) => {
			const lineSubtotal = round2(item.cantidad * item.valorUnitario);
			const lineIgv = round2(lineSubtotal * (item.igvPct / 100));
			const lineTotal = round2(lineSubtotal + lineIgv);
			const valorUnitConIgv = round2(item.valorUnitario * (1 + item.igvPct / 100));
			const igvAffectation = item.igvPct > 0 ? "10" : "20"; // 10=Gravado IGV, 20=Exonerado
			return `        <cac:InvoiceLine>
            <cbc:ID>${idx + 1}</cbc:ID>
            <cbc:InvoicedQuantity unitCode="${escapeXml(item.unidad || "NIU")}">${fmtQty(item.cantidad)}</cbc:InvoicedQuantity>
            <cbc:LineExtensionAmount currencyID="${input.moneda}">${fmt(lineSubtotal)}</cbc:LineExtensionAmount>
            <cac:PricingReference>
                <cac:AlternativeConditionPrice>
                    <cbc:PriceAmount currencyID="${input.moneda}">${fmt(valorUnitConIgv)}</cbc:PriceAmount>
                    <cbc:PriceTypeCode listName="Tipo de Precio" listAgencyName="PE:SUNAT" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16">01</cbc:PriceTypeCode>
                </cac:AlternativeConditionPrice>
            </cac:PricingReference>
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID="${input.moneda}">${fmt(lineIgv)}</cbc:TaxAmount>
                <cac:TaxSubtotal>
                    <cbc:TaxableAmount currencyID="${input.moneda}">${fmt(lineSubtotal)}</cbc:TaxableAmount>
                    <cbc:TaxAmount currencyID="${input.moneda}">${fmt(lineIgv)}</cbc:TaxAmount>
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
                <cbc:PriceAmount currencyID="${input.moneda}">${fmt(item.valorUnitario)}</cbc:PriceAmount>
            </cac:Price>
        </cac:InvoiceLine>`;
		})
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="${NS.xmlns}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent/>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
    <cbc:CustomizationID>2.0</cbc:CustomizationID>
    <cbc:ID>${escapeXml(id)}</cbc:ID>
    <cbc:IssueDate>${input.fechaEmision}</cbc:IssueDate>
    <cbc:InvoiceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">01</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${input.moneda}</cbc:DocumentCurrencyCode>
    <cac:AccountingSupplierParty>
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
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="${input.receptor.tipoDoc}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapeXml(input.receptor.numDoc)}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${input.receptor.rznSocial}]]></cbc:RegistrationName>
                ${input.receptor.direccion ? `<cac:RegistrationAddress><cac:AddressLine><cbc:Line><![CDATA[${input.receptor.direccion}]]></cbc:Line></cac:AddressLine></cac:RegistrationAddress>` : ""}
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${input.moneda}">${fmt(totalIgv)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${input.moneda}">${fmt(totalValor)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${input.moneda}">${fmt(totalIgv)}</cbc:TaxAmount>
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
        <cbc:LineExtensionAmount currencyID="${input.moneda}">${fmt(totalValor)}</cbc:LineExtensionAmount>
        <cbc:TaxInclusiveAmount currencyID="${input.moneda}">${fmt(totalPagar)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${input.moneda}">${fmt(totalPagar)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}
