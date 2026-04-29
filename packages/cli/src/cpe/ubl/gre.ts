/**
 * UBL 2.1 Guía de Remisión Electrónica (GRE) builder for SUNAT.
 *
 * GRE 2022 spec — DespatchAdvice schema, distinct from Invoice (Factura/Boleta).
 *
 * Scope of this PR:
 *   - Tipo doc 09 (Guía de Remisión Remitente)
 *   - codTraslado 01 (Venta) — most common case, room to extend
 *   - modTraslado 02 (Transporte privado) — emisor moves the goods
 *   - codigoTipoOperacion 0101 (Venta interna)
 *
 * Out of scope (deferred to follow-up PRs as needed):
 *   - Modal 01 (Transporte público) — requires <cac:CarrierParty> + RUC + MTC
 *   - Comprador (when distinto del destinatario) — <cac:BuyerCustomerParty>
 *   - Tercero / proveedor — <cac:SellerSupplierParty>
 *   - Documentos relacionados (factura previa, etc) — <cac:AdditionalDocumentReference>
 *   - Importación (codTraslado 02) y otros catálogos 20
 *   - GRE Transportista (tipo doc 31) — different schema
 *   - Multiple choferes (one supported, schema accepts loop)
 *
 * Reference: https://github.com/thegreenter/greenter/blob/master/packages/xml/src/Xml/Templates/despatch2022.xml.twig
 */

import {
	type EmisorCtx,
	NS,
	escapeXml,
	fmt,
	renderCacSignature,
} from "./common.ts";

export const GRE_NS = {
	xmlns: "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2",
	cac: NS.cac,
	cbc: NS.cbc,
	ds: NS.ds,
	ext: NS.ext,
} as const;

export type GreTipoDoc = "09"; // Guía de Remisión Remitente
export type GreCodTraslado = "01" | "02" | "04" | "08" | "09" | "13" | "14" | "18" | "19";
// 01=Venta, 02=Compra, 04=Transf entre estab, 08=Importación, 09=Exportación,
// 13=Otros, 14=Venta sujeta a confirmación, 18=Traslado emisor itinerante CP, 19=Traslado a zona primaria
export type GreModTraslado = "01" | "02"; // 01=Público (transportista), 02=Privado (emisor)
export type GrePersonaTipoDoc = "1" | "4" | "6" | "7" | "0";

export interface GreDestinatario {
	tipoDoc: GrePersonaTipoDoc;
	numDoc: string;
	rznSocial: string;
}

export interface GreChofer {
	tipoDoc: GrePersonaTipoDoc;
	nroDoc: string;
	nombres: string;
	apellidos: string;
	licencia: string;
}

export interface GreVehiculo {
	placa: string; // e.g. "ABC-123"
}

export interface GreDireccion {
	ubigeo: string; // INEI 6-digit code
	direccion: string;
	codLocal?: string; // optional SUNAT establecimiento code (default "0000")
	ruc?: string; // owner of the establecimiento (defaults to emisor RUC)
}

export interface GreItem {
	codigo: string;
	descripcion: string;
	cantidad: number;
	unidad: string; // SUNAT Catalog 03 (e.g. NIU, KGM, ZZ)
	codigoProductoSunat?: string; // Catalog 25 (often "00000000")
}

export interface GreEnvio {
	codTraslado: GreCodTraslado;
	desTraslado?: string;
	modTraslado: GreModTraslado;
	fecTraslado: string; // YYYY-MM-DD
	pesoTotal: number;
	undPesoTotal: string; // KGM, TNE
	numBultos?: number;
	indicadores?: string[]; // SpecialInstructions per Catalog 53 (e.g. "SUNAT_Envio_IndicadorTrasladoTotalDAMoDS")
	chofer?: GreChofer; // required when modTraslado=02
	vehiculo?: GreVehiculo; // required when modTraslado=02
	partida: GreDireccion;
	llegada: GreDireccion;
}

export interface GreInput {
	tipoDoc: GreTipoDoc;
	serie: string; // e.g. "T001"
	numero: number;
	fechaEmision: string; // YYYY-MM-DD
	horaEmision?: string; // HH:mm:ss (defaults to noon if missing)
	observacion?: string;
	destinatario: GreDestinatario;
	envio: GreEnvio;
	items: GreItem[];
}

export interface GreContext {
	emisor: EmisorCtx;
}

/**
 * Filename per SUNAT spec: {RUC}-09-{serie}-{numero}
 */
export function greFilename(emisorRuc: string, serie: string, numero: number): string {
	return `${emisorRuc}-09-${serie}-${numero}`;
}

function renderDespatchLine(item: GreItem, idx: number): string {
	const sunatCode = item.codigoProductoSunat || "00000000";
	return `    <cac:DespatchLine>
        <cbc:ID>${idx + 1}</cbc:ID>
        <cbc:DeliveredQuantity unitCode="${escapeXml(item.unidad)}">${fmt(item.cantidad)}</cbc:DeliveredQuantity>
        <cac:OrderLineReference>
            <cbc:LineID>${idx + 1}</cbc:LineID>
        </cac:OrderLineReference>
        <cac:Item>
            <cbc:Description><![CDATA[${item.descripcion}]]></cbc:Description>
            <cac:SellersItemIdentification>
                <cbc:ID>${escapeXml(item.codigo)}</cbc:ID>
            </cac:SellersItemIdentification>
            <cac:CommodityClassification>
                <cbc:ItemClassificationCode listID="UN/SPSC" listAgencyName="GS1 US" listName="Item Classification">${escapeXml(sunatCode)}</cbc:ItemClassificationCode>
            </cac:CommodityClassification>
        </cac:Item>
    </cac:DespatchLine>`;
}

function renderAddress(addr: GreDireccion, fallbackRuc: string): string {
	const codLocal = addr.codLocal || "0000";
	const ruc = addr.ruc || fallbackRuc;
	return `<cac:DeliveryAddress>
                    <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${escapeXml(addr.ubigeo)}</cbc:ID>
                    <cbc:AddressTypeCode listID="${escapeXml(ruc)}">${escapeXml(codLocal)}</cbc:AddressTypeCode>
                    <cac:AddressLine>
                        <cbc:Line><![CDATA[${addr.direccion}]]></cbc:Line>
                    </cac:AddressLine>
                </cac:DeliveryAddress>`;
}

function renderShipmentStage(envio: GreEnvio, fallbackRuc: string): string {
	const chofer = envio.chofer
		? `            <cac:DriverPerson>
                <cbc:ID schemeID="${envio.chofer.tipoDoc}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapeXml(envio.chofer.nroDoc)}</cbc:ID>
                <cbc:FirstName>${escapeXml(envio.chofer.nombres)}</cbc:FirstName>
                <cbc:FamilyName>${escapeXml(envio.chofer.apellidos)}</cbc:FamilyName>
                <cbc:JobTitle>Principal</cbc:JobTitle>
                <cac:IdentityDocumentReference>
                    <cbc:ID>${escapeXml(envio.chofer.licencia)}</cbc:ID>
                </cac:IdentityDocumentReference>
            </cac:DriverPerson>`
		: "";

	const transitDate = envio.fecTraslado
		? `            <cac:TransitPeriod><cbc:StartDate>${envio.fecTraslado}</cbc:StartDate></cac:TransitPeriod>`
		: "";

	return `        <cac:ShipmentStage>
            <cbc:TransportModeCode listName="Modalidad de traslado" listAgencyName="PE:SUNAT" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo18">${envio.modTraslado}</cbc:TransportModeCode>
${transitDate}
${chofer}
        </cac:ShipmentStage>
        <cac:Delivery>
            ${renderAddress(envio.llegada, fallbackRuc)}
            <cac:Despatch>
                <cac:DespatchAddress>
                    <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${escapeXml(envio.partida.ubigeo)}</cbc:ID>
                    <cac:AddressLine>
                        <cbc:Line><![CDATA[${envio.partida.direccion}]]></cbc:Line>
                    </cac:AddressLine>
                </cac:DespatchAddress>
            </cac:Despatch>
        </cac:Delivery>`;
}

function renderTransportEquipment(vehiculo: GreVehiculo): string {
	return `        <cac:TransportHandlingUnit>
            <cac:TransportEquipment>
                <cbc:ID>${escapeXml(vehiculo.placa)}</cbc:ID>
            </cac:TransportEquipment>
        </cac:TransportHandlingUnit>`;
}

export function buildGreUbl(input: GreInput, ctx: GreContext): string {
	const { emisor } = ctx;
	const id = `${input.serie}-${input.numero}`;
	const horaEmision = input.horaEmision || "12:00:00";
	const lines = input.items.map((item, idx) => renderDespatchLine(item, idx)).join("\n");

	const indicadores = (input.envio.indicadores || [])
		.map((ind) => `        <cbc:SpecialInstructions>${escapeXml(ind)}</cbc:SpecialInstructions>`)
		.join("\n");

	const numBultos = input.envio.numBultos
		? `        <cbc:TotalTransportHandlingUnitQuantity>${input.envio.numBultos}</cbc:TotalTransportHandlingUnitQuantity>`
		: "";

	const transportEq = input.envio.vehiculo ? renderTransportEquipment(input.envio.vehiculo) : "";
	const note = input.observacion ? `    <cbc:Note><![CDATA[${input.observacion}]]></cbc:Note>` : "";

	return `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="${GRE_NS.xmlns}" xmlns:cac="${GRE_NS.cac}" xmlns:cbc="${GRE_NS.cbc}" xmlns:ds="${GRE_NS.ds}" xmlns:ext="${GRE_NS.ext}">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent/>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
    <cbc:CustomizationID>2.0</cbc:CustomizationID>
    <cbc:ID>${escapeXml(id)}</cbc:ID>
    <cbc:IssueDate>${input.fechaEmision}</cbc:IssueDate>
    <cbc:IssueTime>${horaEmision}</cbc:IssueTime>
    <cbc:DespatchAdviceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${input.tipoDoc}</cbc:DespatchAdviceTypeCode>
${note}
${renderCacSignature(emisor)}
    <cac:DespatchSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${emisor.ruc}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${emisor.razonSocial}]]></cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:DespatchSupplierParty>
    <cac:DeliveryCustomerParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="${input.destinatario.tipoDoc}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapeXml(input.destinatario.numDoc)}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${input.destinatario.rznSocial}]]></cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:DeliveryCustomerParty>
    <cac:Shipment>
        <cbc:ID>SUNAT_Envio</cbc:ID>
        <cbc:HandlingCode listAgencyName="PE:SUNAT" listName="Motivo de traslado" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo20">${input.envio.codTraslado}</cbc:HandlingCode>
        ${input.envio.desTraslado ? `<cbc:HandlingInstructions>${escapeXml(input.envio.desTraslado)}</cbc:HandlingInstructions>` : ""}
        <cbc:GrossWeightMeasure unitCode="${escapeXml(input.envio.undPesoTotal)}">${fmt(input.envio.pesoTotal)}</cbc:GrossWeightMeasure>
${numBultos}
${indicadores}
${renderShipmentStage(input.envio, emisor.ruc)}
${transportEq}
    </cac:Shipment>
${lines}
</DespatchAdvice>`;
}
