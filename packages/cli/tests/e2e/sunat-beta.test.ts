/**
 * Opt-in E2E test against SUNAT beta endpoint.
 *
 * Skipped unless ALL of these env vars are set:
 *   SUNAT_TEST_RUC          — emisor RUC 20
 *   SUNAT_TEST_RAZON_SOCIAL — emisor razon social
 *   SUNAT_TEST_USER         — SOL usuario
 *   SUNAT_TEST_PASSWORD     — SOL clave
 *   SUNAT_TEST_CERT_PATH    — path to PFX file
 *   SUNAT_TEST_CERT_PASSWORD
 *
 * Hits https://e-beta.sunat.gob.pe and submits a real Factura. If SUNAT
 * accepts (CDR responseCode=0), test passes. If rejected, prints the CDR
 * description so the dev can fix the input.
 */

import { describe, expect, test } from "bun:test";
import { SunatDirectDriver } from "../../src/cpe/drivers/sunat-direct.ts";
import type { FacturaInput } from "../../src/cpe/drivers/types.ts";

const HAS_CREDS =
	!!process.env.SUNAT_TEST_RUC &&
	!!process.env.SUNAT_TEST_USER &&
	!!process.env.SUNAT_TEST_PASSWORD &&
	!!process.env.SUNAT_TEST_CERT_PATH &&
	!!process.env.SUNAT_TEST_CERT_PASSWORD &&
	!!process.env.SUNAT_TEST_RAZON_SOCIAL;

const describeOrSkip = HAS_CREDS ? describe : describe.skip;

describeOrSkip("SUNAT beta E2E (opt-in)", () => {
	test("emitFactura returns CDR from SUNAT beta", async () => {
		process.env.CPE_EMISOR_RUC = process.env.SUNAT_TEST_RUC;
		process.env.CPE_EMISOR_RAZON_SOCIAL = process.env.SUNAT_TEST_RAZON_SOCIAL;
		process.env.CPE_SOL_USUARIO = process.env.SUNAT_TEST_USER;
		process.env.CPE_SOL_PASSWORD = process.env.SUNAT_TEST_PASSWORD;
		process.env.CPE_CERT_PATH = process.env.SUNAT_TEST_CERT_PATH;
		process.env.CPE_CERT_PASSWORD = process.env.SUNAT_TEST_CERT_PASSWORD;
		process.env.CPE_MODE = "beta";

		const driver = new SunatDirectDriver();
		const numero = Math.floor(Math.random() * 90000) + 10000;
		const input: FacturaInput = {
			receptor: { tipoDoc: "6", numDoc: "20131312955", rznSocial: "MINISTERIO DE EDUCACION" },
			items: [
				{ codigo: "P001", descripcion: "Servicio de prueba sunat-cli", cantidad: 1, unidad: "ZZ", valorUnitario: 100, igvPct: 18 },
			],
			totales: { valorVenta: 100, igv: 18, total: 118 },
			moneda: "PEN",
			serie: "F001",
			numero,
			fechaEmision: new Date().toISOString().split("T")[0],
		};

		const result = await driver.emitFactura(input);
		console.log("CDR result:", { code: result.cdrCode, desc: result.cdrDesc, status: result.status });
		expect(result.cdrCode).toBeDefined();
		expect(result.serie).toBe("F001");
		expect(result.numero).toBe(numero);
	}, 30000);
});

if (!HAS_CREDS) {
	describe("SUNAT beta E2E", () => {
		test.skip("opt-in via env vars (SUNAT_TEST_RUC, SUNAT_TEST_USER, ...)", () => {});
	});
}
