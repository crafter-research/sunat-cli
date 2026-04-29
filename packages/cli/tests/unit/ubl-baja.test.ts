import { describe, expect, test } from "bun:test";
import { type BajaInput, bajaFilenameRA, buildBajaUbl } from "../../src/cpe/ubl/baja.ts";

const ctx = { emisor: { ruc: "20000000001", razonSocial: "EMPRESA EMISORA SAC" } };

const baseInput: BajaInput = {
	fechaEmisionDocs: "2026-04-29",
	fechaComunicacion: "2026-04-30",
	correlativo: 1,
	entries: [
		{ tipoDoc: "03", serie: "B001", numero: 100, motivo: "Anulacion por error en datos" },
		{ tipoDoc: "01", serie: "F001", numero: 50, motivo: "Cliente cancelo" },
	],
};

describe("buildBajaUbl", () => {
	test("starts with XML declaration UTF-8", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});

	test("uses VoidedDocuments root with SUNAT namespace", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml).toContain("<VoidedDocuments");
		expect(xml).toContain('xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1"');
	});

	test("ID format is RA-YYYYMMDD-N", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ID>RA-20260430-1</cbc:ID>");
	});

	test("ReferenceDate is fecha emision de docs anulados", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:ReferenceDate>2026-04-29</cbc:ReferenceDate>");
	});

	test("IssueDate is fecha de comunicacion", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:IssueDate>2026-04-30</cbc:IssueDate>");
	});

	test("contains one VoidedDocumentsLine per entry", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		const lines = xml.match(/<sac:VoidedDocumentsLine>/g) || [];
		expect(lines.length).toBe(2);
	});

	test("each line has DocumentTypeCode + DocumentSerialID + DocumentNumberID + VoidReasonDescription", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml).toContain("<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>");
		expect(xml).toContain("<cbc:DocumentTypeCode>01</cbc:DocumentTypeCode>");
		expect(xml).toContain("<sac:DocumentSerialID>B001</sac:DocumentSerialID>");
		expect(xml).toContain("<sac:DocumentSerialID>F001</sac:DocumentSerialID>");
		expect(xml).toContain("<sac:DocumentNumberID>100</sac:DocumentNumberID>");
		expect(xml).toContain("Anulacion por error en datos");
		expect(xml).toContain("Cliente cancelo");
	});

	test("includes ext:UBLExtensions placeholder", () => {
		const xml = buildBajaUbl(baseInput, ctx);
		expect(xml).toContain("<ext:UBLExtensions>");
		expect(xml).toContain("<ext:ExtensionContent/>");
	});
});

describe("bajaFilenameRA", () => {
	test("RUC-RA-YYYYMMDD-N", () => {
		expect(bajaFilenameRA("20000000001", "2026-04-30", 1)).toBe("20000000001-RA-20260430-1");
	});
});
