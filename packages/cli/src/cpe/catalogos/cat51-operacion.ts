import type { SunatCatalog } from "./types.ts";

export const CAT_51_OPERACION: SunatCatalog = {
	id: "51",
	name: "Tipo de operacion",
	source: "SUNAT Anexo VII Catalogo 51 / Greenter constants",
	entries: [
		{ code: "0101", description: "Venta interna" },
		{ code: "0112", description: "Venta interna - sustenta gastos deducibles persona natural" },
		{ code: "0113", description: "Venta interna - NRUS" },
		{ code: "0200", description: "Exportacion de bienes" },
		{ code: "0201", description: "Exportacion de servicios realizados integramente en el pais" },
		{ code: "0202", description: "Exportacion de servicios de hospedaje no domiciliado" },
		{ code: "0203", description: "Exportacion de servicios - transporte de navieras" },
		{ code: "0204", description: "Exportacion de servicios a naves y aeronaves de bandera extranjera" },
		{ code: "0205", description: "Exportacion de servicios que conformen paquete turistico" },
		{ code: "0206", description: "Exportacion de servicios complementarios al transporte de carga" },
		{ code: "0208", description: "Exportacion de servicios realizados parcialmente en el extranjero" },
		{ code: "0401", description: "Ventas no domiciliados que no califican como exportacion" },
		{ code: "1001", description: "Operacion sujeta a detraccion" },
		{ code: "2001", description: "Operacion sujeta a percepcion" },
	],
};
