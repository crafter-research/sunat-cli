import { describe, expect, test } from "bun:test";
import { MockDriver } from "../../src/cpe/drivers/mock.ts";
import type { FacturaInput, NotaCreditoInput } from "../../src/cpe/drivers/types.ts";

const baseFactura: FacturaInput = {
	receptor: { tipoDoc: "6", numDoc: "20123456789", rznSocial: "ACME SAC" },
	items: [{ codigo: "P001", descripcion: "Test", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
	totales: { valorVenta: 1000, igv: 180, total: 1180 },
	moneda: "PEN",
	serie: "F001",
	numero: 1234,
	fechaEmision: "2026-04-28",
};

describe("MockDriver", () => {
	test("info() returns mock metadata with sandbox mode", () => {
		const driver = new MockDriver();
		const info = driver.info();
		expect(info.name).toBe("mock");
		expect(info.mode).toBe("sandbox");
		expect(info.requiresJava).toBe(false);
		expect(info.acreditadoOse).toBe(false);
	});

	test("doctor() reports ok and never hits the network", async () => {
		const driver = new MockDriver();
		const report = await driver.doctor();
		expect(report.ok).toBe(true);
		expect(report.checks.length).toBeGreaterThan(0);
		for (const check of report.checks) expect(check.ok).toBe(true);
	});

	test("previewFactura() returns deterministic hash for identical input", async () => {
		const driver = new MockDriver();
		const a = await driver.previewFactura(baseFactura);
		const b = await driver.previewFactura(baseFactura);
		expect(a.hash).toBe(b.hash);
		expect(a.hash.startsWith("sha256:")).toBe(true);
		expect(a.wouldSend).toBe(true);
		expect(a.validacion.ok).toBe(true);
		expect(a.xml).toContain('serie="F001"');
		expect(a.xml).toContain('numero="1234"');
		expect(a.xml).toContain('total="1180"');
	});

	test("previewFactura() hash changes when input changes", async () => {
		const driver = new MockDriver();
		const a = await driver.previewFactura(baseFactura);
		const b = await driver.previewFactura({ ...baseFactura, numero: 9999 });
		expect(a.hash).not.toBe(b.hash);
	});

	test("emitFactura() returns accepted CDR with tipoDoc=01", async () => {
		const driver = new MockDriver();
		const result = await driver.emitFactura(baseFactura);
		expect(result.status).toBe("accepted");
		expect(result.cdrCode).toBe("0000");
		expect(result.serie).toBe("F001");
		expect(result.numero).toBe(1234);
		expect(result.xml).toContain('tipoDoc="01"');
		expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(result.ts).toBeDefined();
	});

	test("emitBoleta() uses tipoDoc=03", async () => {
		const driver = new MockDriver();
		const result = await driver.emitBoleta({ ...baseFactura, serie: "B001" });
		expect(result.xml).toContain('tipoDoc="03"');
	});

	test("emitNotaCredito() uses tipoDoc=07", async () => {
		const driver = new MockDriver();
		const nc: NotaCreditoInput = {
			...baseFactura,
			motivo: "Anulacion",
			tipoNota: "01",
			refSerie: "F001",
			refNumero: 1234,
		};
		const result = await driver.emitNotaCredito(nc);
		expect(result.xml).toContain('tipoDoc="07"');
	});

	test("emitNotaDebito() uses tipoDoc=08", async () => {
		const driver = new MockDriver();
		const nd: NotaCreditoInput = {
			...baseFactura,
			motivo: "Recargo",
			tipoNota: "01",
			refSerie: "F001",
			refNumero: 1234,
		};
		const result = await driver.emitNotaDebito(nd);
		expect(result.xml).toContain('tipoDoc="08"');
	});

	test("emit returns unique id per call", async () => {
		const driver = new MockDriver();
		const a = await driver.emitFactura(baseFactura);
		const b = await driver.emitFactura(baseFactura);
		expect(a.id).not.toBe(b.id);
	});
});
