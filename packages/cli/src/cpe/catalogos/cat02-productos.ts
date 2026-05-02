import type { SunatCatalog } from "./types.ts";

export const CAT_02_PRODUCTOS: SunatCatalog = {
	id: "02",
	name: "Productos SUNAT frecuentes",
	source: "Vendor cache from SUNAT Anexo VII / UNSPSC references",
	entries: [
		{ code: "43211500", description: "Computadores" },
		{ code: "43231500", description: "Software funcional especifico de la empresa" },
		{ code: "80101500", description: "Servicios de consultoria de negocios" },
		{ code: "81111500", description: "Ingenieria de software o hardware" },
		{ code: "81111600", description: "Programadores de computador" },
		{ code: "81111700", description: "Sistemas de informacion" },
		{ code: "81111800", description: "Servicios de sistemas y administracion de componentes" },
		{ code: "81112000", description: "Servicios de datos" },
		{ code: "81112100", description: "Servicios de internet" },
		{ code: "84111500", description: "Servicios contables" },
		{ code: "90101500", description: "Establecimientos para comer y beber" },
	],
};
