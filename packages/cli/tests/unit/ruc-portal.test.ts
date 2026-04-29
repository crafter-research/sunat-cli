import { describe, expect, test } from "bun:test";
import { parseRucSnapshot } from "../../src/sunat-rest/ruc-portal.ts";

describe("parseRucSnapshot — pure parser", () => {
	test("parses canonical SUNAT detail page", () => {
		const snap = `
			Resultado de la Búsqueda
			Número de RUC: 20131312955 - SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA - SUNAT
			Tipo Contribuyente: ADMINISTRACION PUBLICA
			Estado del Contribuyente: ACTIVO
			Condición del Contribuyente: HABIDO
			Domicilio Fiscal: AV. GARCILASO DE LA VEGA 1472 LIMA - LIMA - LIMA
		`;
		const r = parseRucSnapshot(snap, "20131312955");
		expect(r?.ruc).toBe("20131312955");
		expect(r?.razonSocial).toContain("SUPERINTENDENCIA NACIONAL");
		expect(r?.estado).toBe("ACTIVO");
		expect(r?.condicion).toBe("HABIDO");
		expect(r?.tipoContribuyente).toBe("ADMINISTRACION PUBLICA");
		expect(r?.direccion).toContain("AV. GARCILASO");
		expect(r?.distrito).toBe("LIMA");
		expect(r?.provincia).toBe("LIMA");
		expect(r?.departamento).toBe("LIMA");
	});

	test("returns null when RUC in page does not match requested", () => {
		const snap = "Número de RUC: 20111111111 - OTRA EMPRESA";
		const r = parseRucSnapshot(snap, "20131312955");
		expect(r).toBeNull();
	});

	test("returns null when no RUC header present", () => {
		expect(parseRucSnapshot("page without RUC", "20131312955")).toBeNull();
	});

	test("handles absent optional fields gracefully", () => {
		const snap = "Número de RUC: 20131312955 - X SAC";
		const r = parseRucSnapshot(snap, "20131312955");
		expect(r?.ruc).toBe("20131312955");
		expect(r?.razonSocial).toBe("X SAC");
		expect(r?.estado).toBeUndefined();
		expect(r?.condicion).toBeUndefined();
	});

	test("strips trailing separator from razon social", () => {
		const snap = "Número de RUC: 20131312955 - EMPRESA SAC\nEstado: ACTIVO";
		const r = parseRucSnapshot(snap, "20131312955");
		expect(r?.razonSocial).toBe("EMPRESA SAC");
	});

	test("handles 'Condicion' without acentos", () => {
		const snap = `Número de RUC: 20131312955 - X
			Condicion del Contribuyente: NO HABIDO`;
		const r = parseRucSnapshot(snap, "20131312955");
		expect(r?.condicion).toBe("NO HABIDO");
	});

	test("source + fetchedAt always populated", () => {
		const snap = "Número de RUC: 20131312955 - X";
		const r = parseRucSnapshot(snap, "20131312955");
		expect(r?.source).toBe("sunat-portal");
		expect(r?.fetchedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
	});
});
