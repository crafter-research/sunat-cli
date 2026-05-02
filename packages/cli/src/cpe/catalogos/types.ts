export interface CatalogEntry {
	code: string;
	description: string;
}

export interface SunatCatalog {
	id: string;
	name: string;
	source: string;
	entries: CatalogEntry[];
}

export interface CatalogWarning {
	code: string;
	field: string;
	catalogo: string;
	value: string;
	message: string;
}

export interface CatalogCoverageReport {
	ok: boolean;
	known: Array<{ field: string; catalogo: string; value: string; description: string }>;
	unknown: CatalogWarning[];
	summary: { known: number; unknown: number };
}
