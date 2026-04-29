import { describe, expect, test } from "bun:test";
import { validateNotaCredito, validateNotaDebito } from "../../src/cpe/validation/reglas.ts";
import type { NotaCreditoInput, NotaDebitoInput } from "../../src/cpe/drivers/types.ts";

const today = new Date().toISOString().split("T")[0];

const validNc: NotaCreditoInput = {
	receptor: { tipoDoc: "6", numDoc: "20536557858", rznSocial: "X SAC" },
	items: [{ codigo: "P", descripcion: "X", cantidad: 1, unidad: "ZZ", valorUnitario: 100, igvPct: 18 }],
	totales: { valorVenta: 100, igv: 18, total: 118 },
	moneda: "PEN",
	serie: "FC01",
	numero: 1,
	fechaEmision: today,
	motivo: "Anulación",
	tipoNota: "01",
	refSerie: "F001",
	refNumero: 1234,
};

const validNd: NotaDebitoInput = { ...validNc, serie: "FD01", motivo: "Mora", tipoNota: "01" };

describe("validateNotaCredito", () => {
	test("happy path returns no errors", () => {
		expect(validateNotaCredito(validNc)).toEqual([]);
	});

	test("rejects invalid serie format", () => {
		const errors = validateNotaCredito({ ...validNc, serie: "X001" });
		expect(errors.some((e) => e.code === "SERIE_FORMAT")).toBe(true);
	});

	test("accepts F-prefix and B-prefix series (NC of factura or boleta)", () => {
		expect(validateNotaCredito({ ...validNc, serie: "FC01" })).toEqual([]);
		expect(validateNotaCredito({ ...validNc, serie: "BC01", refSerie: "B001" })).toEqual([]);
	});

	test("rejects missing refSerie", () => {
		const errors = validateNotaCredito({ ...validNc, refSerie: "" });
		expect(errors.some((e) => e.code === "REF_SERIE_FORMAT")).toBe(true);
	});

	test("rejects malformed refSerie (must be F*** or B***)", () => {
		const errors = validateNotaCredito({ ...validNc, refSerie: "X999" });
		expect(errors.some((e) => e.code === "REF_SERIE_FORMAT")).toBe(true);
	});

	test("rejects refNumero < 1", () => {
		const errors = validateNotaCredito({ ...validNc, refNumero: 0 });
		expect(errors.some((e) => e.code === "REF_NUMERO_RANGE")).toBe(true);
	});

	test("rejects tipoNota not in Catálogo 09", () => {
		const errors = validateNotaCredito({ ...validNc, tipoNota: "99" });
		expect(errors.some((e) => e.code === "TIPO_NOTA_INVALIDO")).toBe(true);
	});

	test("accepts all 13 codes in Catálogo 09", () => {
		const valid09 = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13"];
		for (const code of valid09) {
			expect(validateNotaCredito({ ...validNc, tipoNota: code })).toEqual([]);
		}
	});

	test("rejects empty motivo", () => {
		const errors = validateNotaCredito({ ...validNc, motivo: "" });
		expect(errors.some((e) => e.code === "MOTIVO_REQUIRED")).toBe(true);
	});

	test("rejects motivo > 250 chars", () => {
		const errors = validateNotaCredito({ ...validNc, motivo: "x".repeat(300) });
		expect(errors.some((e) => e.code === "MOTIVO_LENGTH")).toBe(true);
	});

	test("rejects RUC receptor with bad checksum", () => {
		const errors = validateNotaCredito({
			...validNc,
			receptor: { tipoDoc: "6", numDoc: "20131312956", rznSocial: "X" },
		});
		expect(errors.some((e) => e.code === "RUC_RECEPTOR")).toBe(true);
	});

	test("rejects fechaEmision out of plazo (>3 days)", () => {
		const errors = validateNotaCredito({ ...validNc, fechaEmision: "2020-01-01" });
		expect(errors.some((e) => e.code === "FECHA_PLAZO")).toBe(true);
	});

	test("propagates totales mismatch", () => {
		const errors = validateNotaCredito({ ...validNc, totales: { valorVenta: 100, igv: 18, total: 9999 } });
		expect(errors.some((e) => e.code === "TOTAL_TOTAL")).toBe(true);
	});
});

describe("validateNotaDebito", () => {
	test("happy path returns no errors", () => {
		expect(validateNotaDebito(validNd)).toEqual([]);
	});

	test("rejects tipoNota not in Catálogo 10", () => {
		// "04" is in Catálogo 09 but NOT in 10 — must reject for ND
		const errors = validateNotaDebito({ ...validNd, tipoNota: "04" });
		expect(errors.some((e) => e.code === "TIPO_NOTA_INVALIDO")).toBe(true);
	});

	test("accepts all 5 codes in Catálogo 10", () => {
		const valid10 = ["01", "02", "03", "10", "11"];
		for (const code of valid10) {
			expect(validateNotaDebito({ ...validNd, tipoNota: code })).toEqual([]);
		}
	});

	test("rejects code valid in Catálogo 09 but not in 10", () => {
		// "06" (Devolución total) is NC-only
		const errors = validateNotaDebito({ ...validNd, tipoNota: "06" });
		expect(errors.some((e) => e.code === "TIPO_NOTA_INVALIDO")).toBe(true);
	});

	test("shares same series + ref + items + totales rules as NC", () => {
		const errors = validateNotaDebito({ ...validNd, refSerie: "X999" });
		expect(errors.some((e) => e.code === "REF_SERIE_FORMAT")).toBe(true);
	});
});
