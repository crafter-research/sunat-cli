import { describe, expect, test } from "bun:test";
import { buildNotaCreditoUbl, notaCreditoFilename } from "../../src/cpe/ubl/nota-credito.ts";
import type { NotaCreditoInput } from "../../src/cpe/drivers/types.ts";

const ctx = { emisor: { ruc: "20131312955", razonSocial: "EMPRESA EMISORA SAC", ubigeo: "150101", direccion: "AV LIMA 123" } };

const baseInput: NotaCreditoInput = {
	receptor: { tipoDoc: "6", numDoc: "20536557858", rznSocial: "RECEPTOR SAC" },
	items: [{ codigo: "P001", descripcion: "Servicio devuelto", cantidad: 1, unidad: "ZZ", valorUnitario: 1000, igvPct: 18 }],
	totales: { valorVenta: 1000, igv: 180, total: 1180 },
	moneda: "PEN",
	serie: "FC01",
	numero: 100,
	fechaEmision: "2026-04-29",
	motivo: "Anulación por error en datos",
	tipoNota: "01",
	refSerie: "F001",
	refNumero: 1234,
};

describe("buildNotaCreditoUbl", () => {
	test("XML UTF-8 declaration without BOM", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml.charCodeAt(0)).not.toBe(0xfeff);
	});

	test("uses CreditNote root + CreditNote-2 namespace", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<CreditNote ");
		expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
		expect(xml).toContain("</CreditNote>");
	});

	test("does NOT use Invoice root or InvoiceTypeCode (NC has no type code)", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).not.toContain("<Invoice ");
		expect(xml).not.toContain("InvoiceTypeCode");
	});

	test("ID is serie-numero", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ID>FC01-100</cbc:ID>");
	});

	test("DiscrepancyResponse carries refDoc + ResponseCode (Catálogo 09) + Description", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:DiscrepancyResponse>");
		expect(xml).toContain("<cbc:ReferenceID>F001-1234</cbc:ReferenceID>");
		expect(xml).toContain("<cbc:ResponseCode>01</cbc:ResponseCode>");
		expect(xml).toContain("Anulación por error en datos");
	});

	test("BillingReference ties NC to original Factura (DocumentTypeCode=01)", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:BillingReference>");
		expect(xml).toContain("<cbc:ID>F001-1234</cbc:ID>");
		expect(xml).toContain("<cbc:DocumentTypeCode>01</cbc:DocumentTypeCode>");
	});

	test("BillingReference DocumentTypeCode=03 when refSerie starts with B (Boleta)", () => {
		const xml = buildNotaCreditoUbl({ ...baseInput, refSerie: "B001" }, ctx);
		expect(xml).toContain("<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>");
	});

	test("uses CreditNoteLine + CreditedQuantity (NOT InvoiceLine/InvoicedQuantity)", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:CreditNoteLine>");
		expect(xml).toContain("<cbc:CreditedQuantity");
		expect(xml).not.toContain("<cac:InvoiceLine>");
		expect(xml).not.toContain("<cbc:InvoicedQuantity");
	});

	test("emisor + receptor blocks render", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain(">20131312955<");
		expect(xml).toContain("EMPRESA EMISORA SAC");
		expect(xml).toContain(">20536557858<");
		expect(xml).toContain("RECEPTOR SAC");
	});

	test("CreditNoteLine count matches items", () => {
		const multi = {
			...baseInput,
			items: [
				{ codigo: "A", descripcion: "X", cantidad: 1, unidad: "NIU", valorUnitario: 100, igvPct: 18 },
				{ codigo: "B", descripcion: "Y", cantidad: 2, unidad: "NIU", valorUnitario: 50, igvPct: 18 },
				{ codigo: "C", descripcion: "Z", cantidad: 1, unidad: "ZZ", valorUnitario: 50, igvPct: 18 },
			],
			totales: { valorVenta: 250, igv: 45, total: 295 },
		};
		const xml = buildNotaCreditoUbl(multi, ctx);
		expect((xml.match(/<cac:CreditNoteLine>/g) || []).length).toBe(3);
	});

	test("ext:UBLExtensions placeholder for signature", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});

	test("LegalMonetaryTotal carries totals", () => {
		const xml = buildNotaCreditoUbl(baseInput, ctx);
		expect(xml).toContain("<cac:LegalMonetaryTotal>");
		expect(xml).toContain('currencyID="PEN">1180.00</cbc:PayableAmount>');
	});
});

describe("notaCreditoFilename", () => {
	test("RUC-07-SERIE-NUMERO format", () => {
		expect(notaCreditoFilename("20131312955", "FC01", 100)).toBe("20131312955-07-FC01-100");
	});
});
