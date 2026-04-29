import { describe, expect, test } from "bun:test";
import { buildNotaDebitoUbl, notaDebitoFilename } from "../../src/cpe/ubl/nota-debito.ts";
import type { NotaDebitoInput } from "../../src/cpe/drivers/types.ts";

const ctx = { emisor: { ruc: "20131312955", razonSocial: "EMPRESA EMISORA SAC" } };

const baseInput: NotaDebitoInput = {
	receptor: { tipoDoc: "6", numDoc: "20536557858", rznSocial: "RECEPTOR SAC" },
	items: [{ codigo: "P001", descripcion: "Cargo por mora", cantidad: 1, unidad: "ZZ", valorUnitario: 50, igvPct: 18 }],
	totales: { valorVenta: 50, igv: 9, total: 59 },
	moneda: "PEN",
	serie: "FD01",
	numero: 1,
	fechaEmision: "2026-04-29",
	motivo: "Intereses por mora",
	tipoNota: "01",
	refSerie: "F001",
	refNumero: 1234,
};

describe("buildNotaDebitoUbl", () => {
	test("uses DebitNote root + DebitNote-2 namespace", () => {
		const xml = buildNotaDebitoUbl(baseInput, ctx);
		expect(xml).toContain("<DebitNote ");
		expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2"');
		expect(xml).toContain("</DebitNote>");
	});

	test("uses DebitNoteLine + DebitedQuantity", () => {
		const xml = buildNotaDebitoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:DebitNoteLine>");
		expect(xml).toContain("<cbc:DebitedQuantity");
		expect(xml).not.toContain("<cac:CreditNoteLine>");
		expect(xml).not.toContain("<cbc:CreditedQuantity");
	});

	test("uses RequestedMonetaryTotal (NOT LegalMonetaryTotal)", () => {
		const xml = buildNotaDebitoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:RequestedMonetaryTotal>");
		expect(xml).not.toContain("<cac:LegalMonetaryTotal>");
		expect(xml).toContain('currencyID="PEN">59.00</cbc:PayableAmount>');
	});

	test("DiscrepancyResponse uses Catálogo 10 ResponseCode", () => {
		const xml = buildNotaDebitoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:DiscrepancyResponse>");
		expect(xml).toContain("<cbc:ResponseCode>01</cbc:ResponseCode>");
		expect(xml).toContain("Intereses por mora");
	});

	test("BillingReference DocumentTypeCode=03 when refSerie=B***", () => {
		const xml = buildNotaDebitoUbl({ ...baseInput, refSerie: "B001" }, ctx);
		expect(xml).toContain("<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>");
	});

	test("ID format serie-numero", () => {
		const xml = buildNotaDebitoUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ID>FD01-1</cbc:ID>");
	});

	test("ext:UBLExtensions placeholder", () => {
		const xml = buildNotaDebitoUbl(baseInput, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});

	test("multi-line", () => {
		const multi = {
			...baseInput,
			items: [
				{ codigo: "A", descripcion: "Mora", cantidad: 1, unidad: "ZZ", valorUnitario: 50, igvPct: 18 },
				{ codigo: "B", descripcion: "Penalidad", cantidad: 1, unidad: "ZZ", valorUnitario: 25, igvPct: 18 },
			],
			totales: { valorVenta: 75, igv: 13.5, total: 88.5 },
		};
		const xml = buildNotaDebitoUbl(multi, ctx);
		expect((xml.match(/<cac:DebitNoteLine>/g) || []).length).toBe(2);
	});
});

describe("notaDebitoFilename", () => {
	test("RUC-08-SERIE-NUMERO format", () => {
		expect(notaDebitoFilename("20131312955", "FD01", 1)).toBe("20131312955-08-FD01-1");
	});
});
