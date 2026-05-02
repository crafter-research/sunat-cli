import type { SunatCatalog } from "./types.ts";

export const CAT_06_DOCS: SunatCatalog = {
	id: "06",
	name: "Tipo de documento de identidad",
	source: "SUNAT Anexo VII Catalogo 06 / Greenter constants",
	entries: [
		{ code: "0", description: "Doc. trib. no domiciliado sin RUC" },
		{ code: "1", description: "Documento Nacional de Identidad" },
		{ code: "4", description: "Carnet de extranjeria" },
		{ code: "6", description: "Registro Unico de Contribuyentes" },
		{ code: "7", description: "Pasaporte" },
		{ code: "A", description: "Cedula diplomatica de identidad" },
		{ code: "B", description: "Documento de identidad pais de residencia" },
		{ code: "C", description: "TIN" },
		{ code: "D", description: "IN" },
		{ code: "E", description: "Tarjeta Andina de Migracion" },
	],
};
