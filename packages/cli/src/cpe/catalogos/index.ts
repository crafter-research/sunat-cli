import type { FacturaInput } from "../drivers/types.ts";
import { CAT_02_PRODUCTOS } from "./cat02-productos.ts";
import { CAT_03_UNIDADES } from "./cat03-unidades.ts";
import { CAT_06_DOCS } from "./cat06-docs.ts";
import { CAT_51_OPERACION } from "./cat51-operacion.ts";
import type { CatalogCoverageReport, CatalogWarning, SunatCatalog } from "./types.ts";

export const CPE_CATALOGOS = {
	"02": CAT_02_PRODUCTOS,
	"03": CAT_03_UNIDADES,
	"06": CAT_06_DOCS,
	"51": CAT_51_OPERACION,
} as const;

export type CpeCatalogId = keyof typeof CPE_CATALOGOS;

const INDEXES = new Map<CpeCatalogId, Map<string, string>>();

function catalogIndex(id: CpeCatalogId): Map<string, string> {
	const cached = INDEXES.get(id);
	if (cached) return cached;
	const index = new Map(CPE_CATALOGOS[id].entries.map((entry) => [entry.code, entry.description]));
	INDEXES.set(id, index);
	return index;
}

export function getCpeCatalogosSchema(): {
	command: string;
	description: string;
	catalogos: Record<string, SunatCatalog & { total: number }>;
} {
	return {
		command: "schema cpe-catalogos",
		description: "SUNAT CPE catalog cache used for client-side warnings. Unknown codes warn, not error.",
		catalogos: Object.fromEntries(
			Object.entries(CPE_CATALOGOS).map(([id, catalog]) => [id, { ...catalog, total: catalog.entries.length }]),
		),
	};
}

function checkCatalog(
	report: CatalogCoverageReport,
	catalogo: CpeCatalogId,
	field: string,
	value: string | undefined,
	warningCode: string,
): void {
	if (!value) return;
	const description = catalogIndex(catalogo).get(value);
	if (description) {
		report.known.push({ field, catalogo, value, description });
		return;
	}
	const warning: CatalogWarning = {
		code: warningCode,
		field,
		catalogo,
		value,
		message: `Codigo '${value}' no encontrado en Catalogo ${catalogo}. SUNAT puede haberlo agregado recientemente; se permite continuar.`,
	};
	report.unknown.push(warning);
}

export function buildCatalogCoverageReport(input: FacturaInput): CatalogCoverageReport {
	const report: CatalogCoverageReport = { ok: true, known: [], unknown: [], summary: { known: 0, unknown: 0 } };

	checkCatalog(report, "06", "receptor.tipoDoc", input.receptor?.tipoDoc, "CAT_06_UNKNOWN");
	checkCatalog(report, "51", "tipoOperacion", input.tipoOperacion || "0101", "CAT_51_UNKNOWN");

	for (const [idx, item] of input.items.entries()) {
		checkCatalog(report, "03", `items[${idx}].unidad`, item.unidad || "NIU", "CAT_03_UNKNOWN");
		checkCatalog(report, "02", `items[${idx}].codigo`, item.codigo, "CAT_02_UNKNOWN");
	}

	report.summary = { known: report.known.length, unknown: report.unknown.length };
	report.ok = report.unknown.length === 0;
	return report;
}

export function hasCatalogWarnings(report: CatalogCoverageReport): boolean {
	return report.unknown.length > 0;
}
