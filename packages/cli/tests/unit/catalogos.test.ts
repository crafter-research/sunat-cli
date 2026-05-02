import { describe, expect, test } from "bun:test";
import { buildCatalogCoverageReport, getCpeCatalogosSchema } from "../../src/cpe/catalogos/index.ts";
import type { FacturaInput } from "../../src/cpe/drivers/types.ts";

const baseFactura = (overrides: Partial<FacturaInput> = {}): FacturaInput => ({
	receptor: { tipoDoc: "6", numDoc: "20131312955", rznSocial: "RECEPTOR SAC" },
	items: [{ codigo: "81111500", descripcion: "Servicio", cantidad: 1, unidad: "KGM", valorUnitario: 100, igvPct: 18 }],
	totales: { valorVenta: 100, igv: 18, total: 118 },
	moneda: "PEN",
	serie: "F001",
	numero: 1,
	fechaEmision: new Date().toISOString().split("T")[0],
	tipoOperacion: "0101",
	...overrides,
});

describe("CPE SUNAT catalogos", () => {
	test("schema exposes cached catalogs", () => {
		const schema = getCpeCatalogosSchema();
		expect(schema.catalogos["02"].entries.length).toBeGreaterThan(0);
		expect(schema.catalogos["03"].entries.some((entry) => entry.code === "KGM")).toBe(true);
		expect(schema.catalogos["06"].entries.some((entry) => entry.code === "6")).toBe(true);
		expect(schema.catalogos["51"].entries.some((entry) => entry.code === "0101")).toBe(true);
	});

	test("known catalog values produce no warnings", () => {
		const report = buildCatalogCoverageReport(baseFactura());
		expect(report.ok).toBe(true);
		expect(report.unknown).toEqual([]);
	});

	test("unknown catalog values warn without becoming validation errors", () => {
		const report = buildCatalogCoverageReport(
			baseFactura({
				receptor: { tipoDoc: "X", numDoc: "ABC", rznSocial: "X" },
				items: [
					{ codigo: "P001", descripcion: "Servicio", cantidad: 1, unidad: "BAD", valorUnitario: 100, igvPct: 18 },
				],
				tipoOperacion: "9999",
			}),
		);
		expect(report.ok).toBe(false);
		expect(report.unknown.map((warning) => warning.code).sort()).toEqual([
			"CAT_02_UNKNOWN",
			"CAT_03_UNKNOWN",
			"CAT_06_UNKNOWN",
			"CAT_51_UNKNOWN",
		]);
	});
});
