import { describe, expect, test } from "bun:test";
import { parseFacturaInput, parseNotaInput } from "../../src/cpe/parsers.ts";

const validFactura = {
	receptor: { tipoDoc: "6", numDoc: "20123456789", rznSocial: "ACME SAC" },
	items: [{ codigo: "P001", descripcion: "Test", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
	totales: { valorVenta: 1000, igv: 180, total: 1180 },
	serie: "F001",
	numero: 1234,
};

describe("parseFacturaInput", () => {
	test("parses minimal valid input", () => {
		const result = parseFacturaInput(JSON.stringify(validFactura));
		expect(result.receptor.numDoc).toBe("20123456789");
		expect(result.items.length).toBe(1);
		expect(result.totales.total).toBe(1180);
		expect(result.serie).toBe("F001");
		expect(result.numero).toBe(1234);
	});

	test("defaults moneda to PEN", () => {
		const result = parseFacturaInput(JSON.stringify(validFactura));
		expect(result.moneda).toBe("PEN");
	});

	test("respects explicit moneda USD", () => {
		const result = parseFacturaInput(JSON.stringify({ ...validFactura, moneda: "USD" }));
		expect(result.moneda).toBe("USD");
	});

	test("defaults serie to F001 when missing", () => {
		const { serie, ...withoutSerie } = validFactura;
		const result = parseFacturaInput(JSON.stringify(withoutSerie));
		expect(result.serie).toBe("F001");
	});

	test("defaults numero to 1 when missing", () => {
		const { numero, ...withoutNumero } = validFactura;
		const result = parseFacturaInput(JSON.stringify(withoutNumero));
		expect(result.numero).toBe(1);
	});

	test("defaults fechaEmision to today (YYYY-MM-DD)", () => {
		const result = parseFacturaInput(JSON.stringify(validFactura));
		expect(result.fechaEmision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test("respects explicit fechaEmision", () => {
		const result = parseFacturaInput(JSON.stringify({ ...validFactura, fechaEmision: "2026-01-15" }));
		expect(result.fechaEmision).toBe("2026-01-15");
	});

	test("throws on missing receptor", () => {
		const { receptor, ...broken } = validFactura;
		expect(() => parseFacturaInput(JSON.stringify(broken))).toThrow(/Missing required fields/);
	});

	test("throws on missing items", () => {
		const { items, ...broken } = validFactura;
		expect(() => parseFacturaInput(JSON.stringify(broken))).toThrow(/Missing required fields/);
	});

	test("throws on missing totales", () => {
		const { totales, ...broken } = validFactura;
		expect(() => parseFacturaInput(JSON.stringify(broken))).toThrow(/Missing required fields/);
	});

	test("error message points to the schema command", () => {
		try {
			parseFacturaInput("{}");
			expect.unreachable();
		} catch (err) {
			expect((err as Error).message).toContain("sunat schema cpe-factura");
		}
	});

	test("throws on invalid JSON", () => {
		expect(() => parseFacturaInput("not json")).toThrow();
	});
});

describe("parseNotaInput", () => {
	const validNota = {
		...validFactura,
		motivo: "Anulacion por error",
		tipoNota: "01",
		refSerie: "F001",
		refNumero: 1230,
	};

	test("parses valid nota", () => {
		const result = parseNotaInput(JSON.stringify(validNota));
		expect(result.motivo).toBe("Anulacion por error");
		expect(result.tipoNota).toBe("01");
		expect(result.refSerie).toBe("F001");
		expect(result.refNumero).toBe(1230);
	});

	test("defaults motivo to Anulacion when missing", () => {
		const { motivo, ...withoutMotivo } = validNota;
		const result = parseNotaInput(JSON.stringify(withoutMotivo));
		expect(result.motivo).toBe("Anulacion");
	});

	test("inherits factura defaults (moneda PEN, serie F001)", () => {
		const result = parseNotaInput(JSON.stringify(validNota));
		expect(result.moneda).toBe("PEN");
	});

	test("throws when refSerie missing", () => {
		const { refSerie, ...broken } = validNota;
		expect(() => parseNotaInput(JSON.stringify(broken))).toThrow(/refSerie/);
	});

	test("throws when refNumero missing", () => {
		const { refNumero, ...broken } = validNota;
		expect(() => parseNotaInput(JSON.stringify(broken))).toThrow(/refNumero/);
	});

	test("throws when tipoNota missing", () => {
		const { tipoNota, ...broken } = validNota;
		expect(() => parseNotaInput(JSON.stringify(broken))).toThrow(/tipoNota/);
	});

	test("error message points to nota schema", () => {
		const { refSerie, ...broken } = validNota;
		try {
			parseNotaInput(JSON.stringify(broken));
			expect.unreachable();
		} catch (err) {
			expect((err as Error).message).toContain("sunat schema cpe-nota-credito");
		}
	});

	test("propagates factura validation errors", () => {
		const { receptor, ...broken } = validNota;
		expect(() => parseNotaInput(JSON.stringify(broken))).toThrow(/Missing required fields/);
	});
});
