import { describe, expect, test } from "bun:test";
import {
	buildRHEDetailsParams,
	buildRHEIdentityParams,
	extractRHEConfirmation,
	parsePortalAmount,
	type RHEInput,
	toRHEPortalDate,
	toRHEPreviewDate,
} from "../../src/workflows/rhe.ts";

const input: RHEInput = {
	empresa: "CLIENTE RECON",
	tipoDoc: "SIN DOCUMENTO",
	descripcion: "SERVICIO RECON",
	monto: 22399.1,
	moneda: "PEN",
	medioPago: "TRANSFERENCIA",
	fechaEmision: "2026-08-26",
};

describe("RHE portal contract", () => {
	test("converts the CLI date into the field format observed in the portal", () => {
		expect(toRHEPortalDate("2026-08-26")).toBe("26/08/2026");
		expect(toRHEPreviewDate("2026-08-26")).toBe("26 de Agosto de 2026");
		expect(() => toRHEPortalDate("26/08/2026")).toThrow("expected YYYY-MM-DD");
	});

	test("builds the direct identity transition observed in the portal", () => {
		const params = buildRHEIdentityParams(input);
		expect(params.get("accion")).toBe("CapturaDatosReciboHonorariosIdentidad");
		expect(params.get("formaPago")).toBe("CONTADO");
		expect(params.get("tipdoc")).toBe("-");
		expect(params.get("nombrecliente")).toBe("CLIENTE RECON");
	});

	test("builds the direct details transition without the final issue action", () => {
		const params = buildRHEDetailsParams(input);
		expect(params.get("accion")).toBe("CapturaDatosReciboHonorarios");
		expect(params.get("total2")).toBe("22,399.10");
		expect(params.get("cantidad")).toBe("22399.10");
		expect(params.get("fecemi")).toBe("26/08/2026");
		expect(params.get("mediopago")).toBe("003");
		expect(params.toString()).not.toContain("GrabaReciboHonorarios");
	});

	test("parses SUNAT amounts without assuming one thousands separator", () => {
		expect(parsePortalAmount("S/ 1,234.56")).toBe(1234.56);
		expect(parsePortalAmount("1.234,56")).toBe(1234.56);
		expect(parsePortalAmount("6700.00")).toBe(6700);
		expect(Number.isNaN(parsePortalAmount(""))).toBe(true);
	});

	test("extracts the issued RHE identifier from the confirmation page", () => {
		expect(extractRHEConfirmation("Recibo por Honorarios Electrónico E001 - 123456")).toEqual({
			serie: "E001",
			numero: "123456",
		});
		expect(extractRHEConfirmation("Emitido sin identificador visible")).toEqual({});
	});
});
