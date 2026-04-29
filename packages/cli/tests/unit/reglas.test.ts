import { describe, expect, test } from "bun:test";
import {
	round2,
	validateBoletaSerie,
	validateFactura,
	validateFacturaSerie,
	validateFechaPlazo,
	validateRuc20,
	validateRucChecksum,
} from "../../src/cpe/validation/reglas.ts";
import type { FacturaInput } from "../../src/cpe/drivers/types.ts";

describe("validateRucChecksum", () => {
	test("accepts valid RUC 20 (verified by SUNAT modulo-11 algorithm)", () => {
		expect(validateRucChecksum("20131312955")).toBe(true);
		expect(validateRucChecksum("20536557858")).toBe(true);
		expect(validateRucChecksum("10401234565")).toBe(true);
	});

	test("rejects wrong checksum", () => {
		expect(validateRucChecksum("20100070970")).toBe(false);
		expect(validateRucChecksum("20131380951")).toBe(false);
	});

	test("rejects non-11 digits", () => {
		expect(validateRucChecksum("2013131295")).toBe(false);
		expect(validateRucChecksum("201313129550")).toBe(false);
		expect(validateRucChecksum("abc13131295")).toBe(false);
	});
});

describe("validateRuc20", () => {
	test("requires RUC starts with 20 and valid checksum", () => {
		expect(validateRuc20("20131312955")).toBe(true);
		expect(validateRuc20("20536557858")).toBe(true);
	});
	test("rejects RUC 10 (persona natural)", () => {
		expect(validateRuc20("10401234565")).toBe(false);
	});
	test("rejects RUC 20 with invalid checksum", () => {
		expect(validateRuc20("20131380951")).toBe(false);
	});
});

describe("validateFacturaSerie / validateBoletaSerie", () => {
	test("Factura serie F + 3 alphanumeric", () => {
		expect(validateFacturaSerie("F001")).toBe(true);
		expect(validateFacturaSerie("FA01")).toBe(true);
		expect(validateFacturaSerie("B001")).toBe(false);
		expect(validateFacturaSerie("F1")).toBe(false);
	});
	test("Boleta serie B + 3 alphanumeric", () => {
		expect(validateBoletaSerie("B001")).toBe(true);
		expect(validateBoletaSerie("F001")).toBe(false);
	});
});

describe("validateFechaPlazo", () => {
	test("today is valid", () => {
		const today = new Date("2026-04-28T12:00:00Z");
		expect(validateFechaPlazo("2026-04-28", today)).toBe(true);
	});
	test("3 days ago is valid", () => {
		const today = new Date("2026-04-28T12:00:00Z");
		expect(validateFechaPlazo("2026-04-25", today)).toBe(true);
	});
	test("4 days ago is invalid", () => {
		const today = new Date("2026-04-28T12:00:00Z");
		expect(validateFechaPlazo("2026-04-24", today)).toBe(false);
	});
	test("future date is invalid", () => {
		const today = new Date("2026-04-28T12:00:00Z");
		expect(validateFechaPlazo("2026-04-29", today)).toBe(false);
	});
	test("malformed date is invalid", () => {
		expect(validateFechaPlazo("28-04-2026")).toBe(false);
	});
});

describe("round2", () => {
	test("rounds half-away-from-zero with epsilon (handles fp)", () => {
		expect(round2(1.005)).toBe(1.01);
		expect(round2(1180.0049)).toBe(1180.0);
		expect(round2(123.456)).toBe(123.46);
	});
});

const baseFactura = (overrides: Partial<FacturaInput> = {}): FacturaInput => ({
	receptor: { tipoDoc: "6", numDoc: "20131312955", rznSocial: "RECEPTOR SAC" },
	items: [{ codigo: "P001", descripcion: "Servicio", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
	totales: { valorVenta: 1000, igv: 180, total: 1180 },
	moneda: "PEN",
	serie: "F001",
	numero: 1,
	fechaEmision: new Date().toISOString().split("T")[0],
	...overrides,
});

describe("validateFactura", () => {
	test("happy path returns no errors", () => {
		const errors = validateFactura(baseFactura());
		expect(errors).toEqual([]);
	});

	test("flags invalid serie", () => {
		const errors = validateFactura(baseFactura({ serie: "B001" }));
		expect(errors.some((e) => e.code === "SERIE_FORMAT")).toBe(true);
	});

	test("flags out-of-range numero", () => {
		expect(validateFactura(baseFactura({ numero: 0 })).some((e) => e.code === "NUMERO_RANGE")).toBe(true);
		expect(validateFactura(baseFactura({ numero: 99_999_999 })).some((e) => e.code === "NUMERO_RANGE")).toBe(false);
		expect(validateFactura(baseFactura({ numero: 100_000_000 })).some((e) => e.code === "NUMERO_RANGE")).toBe(true);
	});

	test("flags invalid receptor RUC", () => {
		const errors = validateFactura(baseFactura({ receptor: { tipoDoc: "6", numDoc: "20131312956", rznSocial: "X SAC" } }));
		expect(errors.some((e) => e.code === "RUC_RECEPTOR")).toBe(true);
	});

	test("DNI receptor must be 8 digits", () => {
		const errors = validateFactura(baseFactura({ receptor: { tipoDoc: "1", numDoc: "1234567", rznSocial: "Juan" } }));
		expect(errors.some((e) => e.code === "DNI_RECEPTOR")).toBe(true);
	});

	test("flags totales mismatch", () => {
		const errors = validateFactura(baseFactura({ totales: { valorVenta: 1000, igv: 180, total: 9999 } }));
		expect(errors.some((e) => e.code === "TOTAL_TOTAL")).toBe(true);
	});

	test("flags IGV mismatch", () => {
		const errors = validateFactura(baseFactura({ totales: { valorVenta: 1000, igv: 0, total: 1000 } }));
		expect(errors.some((e) => e.code === "TOTAL_IGV")).toBe(true);
	});

	test("flags fechaEmision out of plazo", () => {
		const errors = validateFactura(baseFactura({ fechaEmision: "2020-01-01" }));
		expect(errors.some((e) => e.code === "FECHA_PLAZO")).toBe(true);
	});

	test("flags empty items", () => {
		const errors = validateFactura(baseFactura({ items: [] }));
		expect(errors.some((e) => e.code === "ITEMS_EMPTY")).toBe(true);
	});

	test("flags negative valorUnitario", () => {
		const errors = validateFactura(
			baseFactura({
				items: [{ codigo: "P001", descripcion: "X", cantidad: 1, unidad: "NIU", valorUnitario: -1, igvPct: 18 }],
			}),
		);
		expect(errors.some((e) => e.code === "VALOR_NEGATIVE")).toBe(true);
	});

	test("flags out-of-range igvPct", () => {
		const errors = validateFactura(
			baseFactura({
				items: [{ codigo: "P001", descripcion: "X", cantidad: 1, unidad: "NIU", valorUnitario: 100, igvPct: 25 }],
				totales: { valorVenta: 100, igv: 25, total: 125 },
			}),
		);
		expect(errors.some((e) => e.code === "IGV_PCT_RANGE")).toBe(true);
	});

	test("multi-item totals are computed correctly", () => {
		const errors = validateFactura(
			baseFactura({
				items: [
					{ codigo: "A", descripcion: "Item A", cantidad: 2, unidad: "NIU", valorUnitario: 50, igvPct: 18 },
					{ codigo: "B", descripcion: "Item B", cantidad: 3, unidad: "NIU", valorUnitario: 100, igvPct: 18 },
				],
				totales: { valorVenta: 400, igv: 72, total: 472 },
			}),
		);
		expect(errors).toEqual([]);
	});
});
