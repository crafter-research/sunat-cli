import { describe, expect, test } from "bun:test";
import { buildFacturaUbl, facturaFilename } from "../../src/cpe/ubl/factura.ts";
import type { FacturaInput } from "../../src/cpe/drivers/types.ts";

const ctx = {
	emisor: {
		ruc: "20100070970",
		razonSocial: "EMPRESA EMISORA SAC",
		ubigeo: "150101",
		direccion: "AV LIMA 123",
	},
};

const input: FacturaInput = {
	receptor: { tipoDoc: "6", numDoc: "20131312955", rznSocial: "RECEPTOR SAC", direccion: "JR AYACUCHO 456" },
	items: [{ codigo: "P001", descripcion: "Servicios consultoria", cantidad: 1, unidad: "ZZ", valorUnitario: 1000, igvPct: 18 }],
	totales: { valorVenta: 1000, igv: 180, total: 1180 },
	moneda: "PEN",
	serie: "F001",
	numero: 1234,
	fechaEmision: "2026-04-28",
};

describe("buildFacturaUbl", () => {
	test("starts with XML declaration UTF-8", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});

	test("includes ext:UBLExtensions placeholder for signature", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});

	test("InvoiceTypeCode is 01 (Factura)", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain(">01</cbc:InvoiceTypeCode>");
	});

	test("ID is serie-numero", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain("<cbc:ID>F001-1234</cbc:ID>");
	});

	test("emisor RUC is in PartyIdentification with schemeID=6", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain('schemeID="6"');
		expect(xml).toContain(">20100070970<");
	});

	test("receptor RUC is included with schemeID=6", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain(">20131312955<");
	});

	test("currency code is propagated", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain("<cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>");
		expect(xml).toContain('currencyID="PEN"');
	});

	test("totals are formatted to 2 decimals", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml).toContain('currencyID="PEN">1000.00</cbc:LineExtensionAmount>');
		expect(xml).toContain('currencyID="PEN">180.00</cbc:TaxAmount>');
		expect(xml).toContain('currencyID="PEN">1180.00</cbc:PayableAmount>');
	});

	test("InvoiceLine count matches items", () => {
		const multi = { ...input, items: [...input.items, ...input.items], totales: { valorVenta: 2000, igv: 360, total: 2360 } };
		const xml = buildFacturaUbl(multi, ctx);
		const matches = xml.match(/<cac:InvoiceLine>/g) || [];
		expect(matches.length).toBe(2);
	});

	test("CDATA wraps descripcion to allow special chars", () => {
		const withSpecial = {
			...input,
			items: [{ ...input.items[0], descripcion: "Servicios <Q&A> M&M" }],
		};
		const xml = buildFacturaUbl(withSpecial, ctx);
		expect(xml).toContain("<![CDATA[Servicios <Q&A> M&M]]>");
	});

	test("encoding is UTF-8 without BOM", () => {
		const xml = buildFacturaUbl(input, ctx);
		expect(xml.charCodeAt(0)).not.toBe(0xfeff);
	});
});

describe("facturaFilename", () => {
	test("RUC-01-SERIE-NUMERO format per SUNAT", () => {
		expect(facturaFilename("20100070970", "F001", 1234)).toBe("20100070970-01-F001-1234");
	});
});
