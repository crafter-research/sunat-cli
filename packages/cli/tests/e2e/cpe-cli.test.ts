import { describe, expect, test } from "bun:test";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

const validFactura = {
	receptor: { tipoDoc: "6", numDoc: "20123456789", rznSocial: "ACME SAC" },
	items: [{ codigo: "P001", descripcion: "Test", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
	totales: { valorVenta: 1000, igv: 180, total: 1180 },
	serie: "F001",
	numero: 1234,
};

interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, CPE_DRIVER: "mock" },
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

function parseJson<T = unknown>(stdout: string): T {
	return JSON.parse(stdout) as T;
}

describe("sunat cpe — E2E", () => {
	test("--help lists cpe namespace", async () => {
		const result = await runCli(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("cpe");
		expect(result.stdout).toContain("RUC 20");
	});

	test("cpe --help lists doctor, info, factura, boleta, nc, nd, guia, resumen, baja, cdr", async () => {
		const result = await runCli(["cpe", "--help"]);
		expect(result.exitCode).toBe(0);
		for (const verb of ["doctor", "info", "factura", "boleta", "nc", "nd", "guia", "resumen", "baja", "cdr"]) {
			expect(result.stdout).toContain(verb);
		}
	});

	test("cpe doctor returns valid JSON with mock driver", async () => {
		const result = await runCli(["-o", "json", "cpe", "doctor"]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ ok: boolean; driver: { name: string }; checks: unknown[] }>(result.stdout);
		expect(json.ok).toBe(true);
		expect(json.driver.name).toBe("mock");
		expect(json.checks.length).toBeGreaterThan(0);
	});

	test("cpe info returns driver metadata", async () => {
		const result = await runCli(["-o", "json", "cpe", "info"]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ name: string; mode: string; requiresJava: boolean }>(result.stdout);
		expect(json.name).toBe("mock");
		expect(json.mode).toBe("sandbox");
		expect(json.requiresJava).toBe(false);
	});

	test("schema cpe-factura returns introspectable JSON", async () => {
		const result = await runCli(["-o", "json", "schema", "cpe-factura"]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ command: string; fields: Record<string, unknown> }>(result.stdout);
		expect(json.command).toBe("cpe factura emit");
		expect(json.fields.receptor).toBeDefined();
		expect(json.fields.items).toBeDefined();
		expect(json.fields.totales).toBeDefined();
	});

	test("schema cpe-boleta and cpe-nota-credito are listed", async () => {
		for (const name of ["cpe-boleta", "cpe-nota-credito"]) {
			const result = await runCli(["-o", "json", "schema", name]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('"command"');
		}
	});

	test("cpe factura preview (T0) returns dryRun=true with deterministic hash", async () => {
		const result = await runCli(["-o", "json", "cpe", "factura", "preview", "--params", JSON.stringify(validFactura)]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ dryRun: boolean; hash: string; xml: string; validacion: { ok: boolean } }>(result.stdout);
		expect(json.dryRun).toBe(true);
		expect(json.hash.startsWith("sha256:")).toBe(true);
		expect(json.xml).toContain("F001");
		expect(json.validacion.ok).toBe(true);
	});

	test("cpe factura emit --dry-run does not require --yes", async () => {
		const result = await runCli([
			"-o",
			"json",
			"cpe",
			"factura",
			"emit",
			"--params",
			JSON.stringify(validFactura),
			"--dry-run",
		]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ dryRun: boolean }>(result.stdout);
		expect(json.dryRun).toBe(true);
	});

	test("cpe factura emit without --yes errors clearly (T2 gate)", async () => {
		const result = await runCli(["-o", "json", "cpe", "factura", "emit", "--params", JSON.stringify(validFactura)]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--yes");
	});

	test("cpe factura emit --yes returns accepted CDR", async () => {
		const result = await runCli([
			"-o",
			"json",
			"cpe",
			"factura",
			"emit",
			"--params",
			JSON.stringify(validFactura),
			"--yes",
		]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ success: boolean; status: string; cdrCode: string; serie: string; numero: number }>(
			result.stdout,
		);
		expect(json.success).toBe(true);
		expect(json.status).toBe("accepted");
		expect(json.cdrCode).toBe("0000");
		expect(json.serie).toBe("F001");
		expect(json.numero).toBe(1234);
	});

	test("cpe boleta emit --yes succeeds via mock", async () => {
		const result = await runCli([
			"-o",
			"json",
			"cpe",
			"boleta",
			"emit",
			"--params",
			JSON.stringify({ ...validFactura, serie: "B001" }),
			"--yes",
		]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ success: boolean; serie: string }>(result.stdout);
		expect(json.success).toBe(true);
		expect(json.serie).toBe("B001");
	});

	test("cpe nc emit requires refSerie/refNumero/tipoNota", async () => {
		const result = await runCli([
			"-o",
			"json",
			"cpe",
			"nc",
			"emit",
			"--params",
			JSON.stringify(validFactura),
			"--yes",
		]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("refSerie");
	});

	test("cpe nc emit --yes succeeds with full nota payload", async () => {
		const nota = { ...validFactura, motivo: "Anulacion", tipoNota: "01", refSerie: "F001", refNumero: 1230 };
		const result = await runCli(["-o", "json", "cpe", "nc", "emit", "--params", JSON.stringify(nota), "--yes"]);
		expect(result.exitCode).toBe(0);
		const json = parseJson<{ success: boolean; status: string }>(result.stdout);
		expect(json.success).toBe(true);
		expect(json.status).toBe("accepted");
	});

	test("cpe --driver facturador errors with clear unimplemented message", async () => {
		const result = await runCli(["-o", "json", "cpe", "--driver", "facturador", "doctor"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("not implemented");
	});

	test("cpe --driver sunat-direct doctor reports config_resolved=false without env", async () => {
		const proc = Bun.spawn(["bun", "run", CLI, "-o", "json", "cpe", "--driver", "sunat-direct", "doctor"], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				CPE_DRIVER: undefined,
				CPE_EMISOR_RUC: undefined,
				CPE_EMISOR_RAZON_SOCIAL: undefined,
				CPE_PROFILE: undefined,
			} as Record<string, string | undefined>,
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		const json = JSON.parse(stdout) as { ok: boolean; checks: Array<{ name: string; ok: boolean }> };
		expect(json.ok).toBe(false);
		expect(json.checks.find((c) => c.name === "config_resolved")?.ok).toBe(false);
	});

	test("cpe nd emit returns shaped-not-implemented stub error", async () => {
		const result = await runCli(["-o", "json", "cpe", "nd", "emit", "--params", "{}", "--yes"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("not implemented");
	});

	test("cpe gre --help lists emit + status verbs", async () => {
		const result = await runCli(["cpe", "gre", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("emit");
		expect(result.stdout).toContain("status");
		expect(result.stdout).toContain("REST");
	});

	test("cpe gre emit requires --params flag", async () => {
		const result = await runCli(["-o", "json", "cpe", "gre", "emit"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--params");
	});

	test("cpe guia (legacy alias) prints redirect notice", async () => {
		const result = await runCli(["-o", "json", "cpe", "guia"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("cpe gre");
	});

	test("cpe resumen send requires --fecha flag", async () => {
		const result = await runCli(["-o", "json", "cpe", "resumen", "send"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--fecha");
	});

	test("cpe resumen send without --yes errors clearly (T2 gate)", async () => {
		const result = await runCli(["-o", "json", "cpe", "resumen", "send", "--fecha", "2026-04-29"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--yes");
	});

	test("cpe resumen status requires --ticket flag", async () => {
		const result = await runCli(["-o", "json", "cpe", "resumen", "status"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--ticket");
	});

	test("cpe baja send requires --params flag", async () => {
		const result = await runCli(["-o", "json", "cpe", "baja", "send"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--params");
	});

	test("cpe baja send without --yes errors clearly (T2 gate)", async () => {
		const result = await runCli([
			"-o",
			"json",
			"cpe",
			"baja",
			"send",
			"--params",
			'{"fechaEmisionDocs":"2026-04-29","entries":[{"tipoDoc":"03","serie":"B001","numero":1,"motivo":"x"}]}',
		]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("--yes");
	});

	test("cpe boleta queue rejects boletas >= S/700 (must use emit individual)", async () => {
		const params = JSON.stringify({
			receptor: { tipoDoc: "1", numDoc: "12345678", rznSocial: "X" },
			items: [{ codigo: "P", descripcion: "X", cantidad: 1, unidad: "NIU", valorUnitario: 1000, igvPct: 18 }],
			totales: { valorVenta: 1000, igv: 180, total: 1180 },
			serie: "B001",
			numero: 999,
			fechaEmision: new Date().toISOString().split("T")[0],
		});
		const result = await runCli(["-o", "json", "cpe", "boleta", "queue", "--params", params]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("S/700");
	});

	test("cpe cdr get returns shaped-not-implemented stub error", async () => {
		const result = await runCli(["-o", "json", "cpe", "cdr", "get"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("not implemented");
	});
});
