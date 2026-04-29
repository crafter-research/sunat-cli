import { describe, expect, test } from "bun:test";
import { validateBoleta } from "../../src/cpe/validation/reglas.ts";
import type { BoletaInput } from "../../src/cpe/drivers/types.ts";

const todayStr = new Date().toISOString().split("T")[0];

const baseBoleta = (overrides: Partial<BoletaInput> = {}): BoletaInput => ({
	receptor: { tipoDoc: "1", numDoc: "12345678", rznSocial: "JUAN PEREZ" },
	items: [{ codigo: "P001", descripcion: "Cafe", cantidad: 1, unidad: "NIU", valorUnitario: 50, igvPct: 18 }],
	totales: { valorVenta: 50, igv: 9, total: 59 },
	moneda: "PEN",
	serie: "B001",
	numero: 1,
	fechaEmision: todayStr,
	...overrides,
});

describe("validateBoleta", () => {
	test("happy path returns no errors", () => {
		expect(validateBoleta(baseBoleta())).toEqual([]);
	});

	test("flags invalid serie (must start with B)", () => {
		const errors = validateBoleta(baseBoleta({ serie: "F001" }));
		expect(errors.some((e) => e.code === "SERIE_FORMAT")).toBe(true);
	});

	test("accepts B001..BZZZ alphanumeric", () => {
		expect(validateBoleta(baseBoleta({ serie: "BA01" })).some((e) => e.code === "SERIE_FORMAT")).toBe(false);
		expect(validateBoleta(baseBoleta({ serie: "BZZZ" })).some((e) => e.code === "SERIE_FORMAT")).toBe(false);
	});

	test("flags out-of-range numero", () => {
		expect(validateBoleta(baseBoleta({ numero: 0 })).some((e) => e.code === "NUMERO_RANGE")).toBe(true);
		expect(validateBoleta(baseBoleta({ numero: 100_000_000 })).some((e) => e.code === "NUMERO_RANGE")).toBe(true);
	});

	test("flags fechaEmision out of plazo (3 days)", () => {
		expect(validateBoleta(baseBoleta({ fechaEmision: "2020-01-01" })).some((e) => e.code === "FECHA_PLAZO")).toBe(true);
	});

	test("DNI receptor must be 8 digits", () => {
		const errors = validateBoleta(
			baseBoleta({ receptor: { tipoDoc: "1", numDoc: "1234567", rznSocial: "X" } }),
		);
		expect(errors.some((e) => e.code === "DNI_RECEPTOR")).toBe(true);
	});

	test("RUC receptor (when used) must have valid checksum", () => {
		const errors = validateBoleta(
			baseBoleta({ receptor: { tipoDoc: "6", numDoc: "20131312956", rznSocial: "X" } }),
		);
		expect(errors.some((e) => e.code === "RUC_RECEPTOR")).toBe(true);
	});

	test("Cliente Varios (no receptor) is valid for boleta < S/700", () => {
		const errors = validateBoleta(
			baseBoleta({
				receptor: undefined as unknown as BoletaInput["receptor"],
			}),
		);
		expect(errors.some((e) => e.code === "RECEPTOR_REQUIRED")).toBe(false);
	});

	test("Receptor REQUIRED when total >= S/700", () => {
		const errors = validateBoleta(
			baseBoleta({
				receptor: undefined as unknown as BoletaInput["receptor"],
				items: [{ codigo: "P", descripcion: "X", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
				totales: { valorVenta: 1000, igv: 180, total: 1180 },
			}),
		);
		expect(errors.some((e) => e.code === "RECEPTOR_REQUIRED")).toBe(true);
	});

	test("Receptor with empty numDoc is treated as missing for >= S/700", () => {
		const errors = validateBoleta(
			baseBoleta({
				receptor: { tipoDoc: "1", numDoc: "", rznSocial: "X" },
				items: [{ codigo: "P", descripcion: "X", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
				totales: { valorVenta: 1000, igv: 180, total: 1180 },
			}),
		);
		expect(errors.some((e) => e.code === "RECEPTOR_REQUIRED")).toBe(true);
	});

	test("propagates totales mismatch", () => {
		const errors = validateBoleta(
			baseBoleta({ totales: { valorVenta: 50, igv: 9, total: 9999 } }),
		);
		expect(errors.some((e) => e.code === "TOTAL_TOTAL")).toBe(true);
	});

	test("flags empty items", () => {
		const errors = validateBoleta(baseBoleta({ items: [] }));
		expect(errors.some((e) => e.code === "ITEMS_EMPTY")).toBe(true);
	});

	test("multi-item totals computed correctly", () => {
		const errors = validateBoleta(
			baseBoleta({
				items: [
					{ codigo: "A", descripcion: "Item A", cantidad: 2, unidad: "NIU", valorUnitario: 50, igvPct: 18 },
					{ codigo: "B", descripcion: "Item B", cantidad: 3, unidad: "NIU", valorUnitario: 30, igvPct: 18 },
				],
				totales: { valorVenta: 190, igv: 34.2, total: 224.2 },
			}),
		);
		expect(errors).toEqual([]);
	});
});
