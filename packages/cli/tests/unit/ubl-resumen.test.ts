import { describe, expect, test } from "bun:test";
import { bajaFilename, buildResumenUbl, resumenFilename } from "../../src/cpe/ubl/resumen.ts";
import type { ResumenInput } from "../../src/cpe/ubl/resumen.ts";

const ctx = { emisor: { ruc: "20000000001", razonSocial: "EMPRESA EMISORA SAC" } };

const baseInput: ResumenInput = {
	fechaEmisionBoletas: "2026-04-29",
	fechaResumen: "2026-04-30",
	correlativo: 1,
	entries: [
		{
			tipoDoc: "03",
			serie: "B001",
			numero: 1,
			receptor: { tipoDoc: "1", numDoc: "12345678" },
			totales: { valorVenta: 50, igv: 9, total: 59 },
			moneda: "PEN",
		},
		{
			tipoDoc: "03",
			serie: "B001",
			numero: 2,
			totales: { valorVenta: 100, igv: 18, total: 118 },
			moneda: "PEN",
		},
	],
};

describe("buildResumenUbl", () => {
	test("starts with XML declaration UTF-8", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});

	test("uses SummaryDocuments root with SUNAT namespace", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<SummaryDocuments");
		expect(xml).toContain('xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1"');
		expect(xml).toContain("xmlns:sac=");
	});

	test("ID format is RC-YYYYMMDD-N", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ID>RC-20260430-1</cbc:ID>");
	});

	test("ReferenceDate is fecha de emision de boletas", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ReferenceDate>2026-04-29</cbc:ReferenceDate>");
	});

	test("IssueDate is fecha de envio del resumen", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:IssueDate>2026-04-30</cbc:IssueDate>");
	});

	test("contains one SummaryDocumentsLine per entry", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		const lines = xml.match(/<sac:SummaryDocumentsLine>/g) || [];
		expect(lines.length).toBe(2);
	});

	test("each line has DocumentTypeCode + ID + ConditionCode + TotalAmount", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>");
		expect(xml).toContain("<cbc:ID>B001-1</cbc:ID>");
		expect(xml).toContain("<cbc:ID>B001-2</cbc:ID>");
		expect(xml).toContain("<cbc:ConditionCode>1</cbc:ConditionCode>");
		expect(xml).toContain('currencyID="PEN">59.00</sac:TotalAmount>');
		expect(xml).toContain('currencyID="PEN">118.00</sac:TotalAmount>');
	});

	test("includes receptor when provided, omits when not", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain(">12345678</cbc:CustomerAssignedAccountID>");
		const lineCount = (xml.match(/<sac:SummaryDocumentsLine>/g) || []).length;
		const customerCount = (xml.match(/<cac:AccountingCustomerParty>/g) || []).length;
		expect(lineCount).toBe(2);
		// 1 emisor + 1 entry with receptor = 2 AccountingCustomerParty wrappers... actually
		// emisor uses AccountingSupplierParty. Receptor uses AccountingCustomerParty. So 1 only.
		expect(customerCount).toBe(1);
	});

	test("supports anular condition code (3)", () => {
		const xml = buildResumenUbl(
			{
				...baseInput,
				entries: [{ ...baseInput.entries[0], status: "3" }],
			},
			ctx,
		);
		expect(xml).toContain("<cbc:ConditionCode>3</cbc:ConditionCode>");
	});

	test("Status uses cac: prefix (NOT sac:) per SUNAT XSD", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<cac:Status>");
		expect(xml).not.toContain("<sac:Status>");
	});

	test("emisor RUC + razonSocial in AccountingSupplierParty", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain(">20000000001</cbc:CustomerAssignedAccountID>");
		expect(xml).toContain("EMPRESA EMISORA SAC");
	});

	test("includes ext:UBLExtensions placeholder for signature", () => {
		const xml = buildResumenUbl(baseInput, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});
});

describe("resumenFilename / bajaFilename", () => {
	test("RUC-RC-YYYYMMDD-N for resumen", () => {
		expect(resumenFilename("20000000001", "2026-04-30", 1)).toBe("20000000001-RC-20260430-1");
	});
	test("RUC-RA-YYYYMMDD-N for baja", () => {
		expect(bajaFilename("20000000001", "2026-04-30", 1)).toBe("20000000001-RA-20260430-1");
	});
});
