import { describe, expect, test } from "bun:test";
import { type GreInput, buildGreUbl, greFilename } from "../../src/cpe/ubl/gre.ts";

const ctx = { emisor: { ruc: "20131312955", razonSocial: "EMPRESA EMISORA SAC" } };

const baseInput: GreInput = {
	tipoDoc: "09",
	serie: "T001",
	numero: 1,
	fechaEmision: "2026-04-29",
	horaEmision: "12:00:00",
	destinatario: { tipoDoc: "6", numDoc: "20100070970", rznSocial: "CLIENTE SAC" },
	envio: {
		codTraslado: "01",
		modTraslado: "02",
		fecTraslado: "2026-04-29",
		pesoTotal: 100.5,
		undPesoTotal: "KGM",
		numBultos: 2,
		chofer: { tipoDoc: "1", nroDoc: "12345678", nombres: "JUAN", apellidos: "PEREZ", licencia: "Q12345678" },
		vehiculo: { placa: "ABC-123" },
		partida: { ubigeo: "150101", direccion: "AV LIMA 123" },
		llegada: { ubigeo: "150114", direccion: "AV ALIVERTI 456" },
	},
	items: [
		{ codigo: "P001", descripcion: "Caja de cervezas", cantidad: 10, unidad: "NIU" },
	],
};

describe("buildGreUbl", () => {
	test("starts with XML UTF-8 declaration", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});

	test("uses DespatchAdvice root", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<DespatchAdvice");
		expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"');
	});

	test("DespatchAdviceTypeCode is the input tipoDoc", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain(">09</cbc:DespatchAdviceTypeCode>");
	});

	test("ID is serie-numero", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ID>T001-1</cbc:ID>");
	});

	test("includes ext:UBLExtensions placeholder", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});

	test("emisor RUC in DespatchSupplierParty", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<cac:DespatchSupplierParty>");
		expect(xml).toContain(">20131312955<");
	});

	test("destinatario in DeliveryCustomerParty", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<cac:DeliveryCustomerParty>");
		expect(xml).toContain(">20100070970<");
		expect(xml).toContain("CLIENTE SAC");
	});

	test("Shipment carries codTraslado in HandlingCode", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:HandlingCode");
		expect(xml).toContain(">01</cbc:HandlingCode>");
	});

	test("modTraslado in TransportModeCode", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain(">02</cbc:TransportModeCode>");
	});

	test("chofer rendered when modTraslado=02", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<cac:DriverPerson>");
		expect(xml).toContain(">12345678<");
		expect(xml).toContain("Q12345678");
	});

	test("vehiculo placa in TransportEquipment", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain("<cac:TransportEquipment>");
		expect(xml).toContain(">ABC-123<");
	});

	test("ubigeos in DeliveryAddress + DespatchAddress", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain(">150114<"); // llegada
		expect(xml).toContain(">150101<"); // partida
	});

	test("DespatchLine count matches items", () => {
		const multi = { ...baseInput, items: [...baseInput.items, ...baseInput.items] };
		const xml = buildGreUbl(multi, ctx);
		const matches = xml.match(/<cac:DespatchLine>/g) || [];
		expect(matches.length).toBe(2);
	});

	test("GrossWeightMeasure formatted", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml).toContain('unitCode="KGM"');
		expect(xml).toContain(">100.50</cbc:GrossWeightMeasure>");
	});

	test("encoding is UTF-8 without BOM", () => {
		const xml = buildGreUbl(baseInput, ctx);
		expect(xml.charCodeAt(0)).not.toBe(0xfeff);
	});
});

describe("greFilename", () => {
	test("RUC-09-SERIE-NUMERO format", () => {
		expect(greFilename("20131312955", "T001", 1234)).toBe("20131312955-09-T001-1234");
	});
});
