import { describe, expect, test } from "bun:test";
import {
	BOLETA_RECEPTOR_REQUIRED_THRESHOLD,
	boletaFilename,
	boletaRequiresIndividualSubmission,
	boletaRequiresReceptor,
	buildBoletaUbl,
} from "../../src/cpe/ubl/boleta.ts";
import type { BoletaInput } from "../../src/cpe/drivers/types.ts";

const ctx = {
	emisor: {
		ruc: "20000000001",
		razonSocial: "EMPRESA EMISORA SAC",
		ubigeo: "150101",
		direccion: "AV LIMA 123",
	},
};

const baseInput: BoletaInput = {
	receptor: { tipoDoc: "1", numDoc: "12345678", rznSocial: "JUAN PEREZ" },
	items: [{ codigo: "P001", descripcion: "Cafe", cantidad: 1, unidad: "NIU", valorUnitario: 50, igvPct: 18 }],
	totales: { valorVenta: 50, igv: 9, total: 59 },
	moneda: "PEN",
	serie: "B001",
	numero: 1234,
	fechaEmision: "2026-04-29",
};

describe("buildBoletaUbl", () => {
	test("starts with XML declaration UTF-8", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});

	test("InvoiceTypeCode is 03 (Boleta)", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain(">03</cbc:InvoiceTypeCode>");
	});

	test("ID is serie-numero with B prefix", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ID>B001-1234</cbc:ID>");
	});

	test("includes ext:UBLExtensions placeholder for signature", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});

	test("DNI receptor uses schemeID=1", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain('schemeID="1"');
		expect(xml).toContain(">12345678<");
	});

	test("falls back to Cliente Varios when receptor is missing", () => {
		const noReceptor: BoletaInput = {
			...baseInput,
			receptor: undefined as unknown as BoletaInput["receptor"],
		};
		const xml = buildBoletaUbl(noReceptor, ctx);
		expect(xml).toContain("Cliente Varios");
		expect(xml).toContain(">00000000<");
	});

	test("emisor RUC is in PartyIdentification with schemeID=6", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain('schemeID="6"');
		expect(xml).toContain(">20000000001<");
	});

	test("currency code propagates", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>");
		expect(xml).toContain('currencyID="PEN"');
	});

	test("PayableAmount matches totales.total formatted to 2 decimals", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml).toContain('currencyID="PEN">59.00</cbc:PayableAmount>');
	});

	test("InvoiceLine count matches items", () => {
		const multi: BoletaInput = {
			...baseInput,
			items: [
				{ codigo: "A", descripcion: "Item A", cantidad: 1, unidad: "NIU", valorUnitario: 50, igvPct: 18 },
				{ codigo: "B", descripcion: "Item B", cantidad: 2, unidad: "NIU", valorUnitario: 25, igvPct: 18 },
			],
			totales: { valorVenta: 100, igv: 18, total: 118 },
		};
		const xml = buildBoletaUbl(multi, ctx);
		const matches = xml.match(/<cac:InvoiceLine>/g) || [];
		expect(matches.length).toBe(2);
	});

	test("encoding is UTF-8 without BOM", () => {
		const xml = buildBoletaUbl(baseInput, ctx);
		expect(xml.charCodeAt(0)).not.toBe(0xfeff);
	});
});

describe("boletaFilename", () => {
	test("RUC-03-SERIE-NUMERO format per SUNAT", () => {
		expect(boletaFilename("20000000001", "B001", 1234)).toBe("20000000001-03-B001-1234");
	});
});

describe("boletaRequiresReceptor / boletaRequiresIndividualSubmission", () => {
	test("threshold is S/700", () => {
		expect(BOLETA_RECEPTOR_REQUIRED_THRESHOLD).toBe(700);
	});
	test("returns false below S/700", () => {
		expect(boletaRequiresReceptor(699.99)).toBe(false);
		expect(boletaRequiresIndividualSubmission(500)).toBe(false);
	});
	test("returns true at or above S/700", () => {
		expect(boletaRequiresReceptor(700)).toBe(true);
		expect(boletaRequiresReceptor(1500)).toBe(true);
		expect(boletaRequiresIndividualSubmission(700)).toBe(true);
	});
});
