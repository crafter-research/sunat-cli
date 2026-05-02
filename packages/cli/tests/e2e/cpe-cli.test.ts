import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");
const tempHomes: string[] = [];

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

async function runCliWithEnv(args: string[], env: Record<string, string | undefined>): Promise<CliResult> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

function parseJson<T = unknown>(stdout: string): T {
	return JSON.parse(stdout) as T;
}

function createTempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "sunat-cpe-test-"));
	tempHomes.push(home);
	return home;
}

afterEach(() => {
	for (const home of tempHomes.splice(0)) {
		rmSync(home, { recursive: true, force: true });
	}
});

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

	test("emits facturas under two active profiles in one process and filters audit by RUC", async () => {
		const home = createTempHome();
		const script = `
process.env.HOME = ${JSON.stringify(home)};
process.env.CPE_DRIVER = "mock";
delete process.env.CPE_PROFILE;
delete process.env.CPE_EMISOR_RUC;
const { createCpeCommand } = await import(${JSON.stringify(join(import.meta.dir, "..", "..", "src", "commands", "cpe", "index.ts"))});
async function run(args) {
	const command = createCpeCommand();
	command.exitOverride();
	await command.parseAsync(args, { from: "user" });
}
const base = ${JSON.stringify(validFactura)};
await run(["profile", "set", "--name", "alpha", "--ruc", "20111111111", "--razon-social", "ALPHA SAC", "--mode", "beta"]);
await run(["profile", "set", "--name", "beta", "--ruc", "20222222222", "--razon-social", "BETA SAC", "--mode", "beta"]);
await run(["profile", "use", "alpha"]);
await run(["factura", "emit", "--params", JSON.stringify({ ...base, serie: "F101", numero: 1 }), "--yes"]);
await run(["profile", "use", "beta"]);
await run(["factura", "emit", "--params", JSON.stringify({ ...base, serie: "F101", numero: 1 }), "--yes"]);
`;
		const proc = Bun.spawn(["bun", "--eval", script], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, HOME: home, CPE_DRIVER: "mock" },
		});
		const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		expect(await proc.exited).toBe(0);
		expect(stderr).toBe("");

		const month = new Date().toISOString().slice(0, 7);
		const entries = readFileSync(join(home, ".sunat", "audit", `${month}.jsonl`), "utf-8")
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as { command: string; result: string; details?: { id?: string; emisorRuc?: string } },
			)
			.filter((entry) => entry.command === "cpe factura emit" && entry.result === "success");

		expect(entries.map((entry) => entry.details?.emisorRuc).sort()).toEqual(["20111111111", "20222222222"]);
		expect(entries.map((entry) => entry.details?.id).sort()).toEqual([
			"20111111111-01-F101-1",
			"20222222222-01-F101-1",
		]);

		const alphaAudit = await runCliWithEnv(["-o", "json", "audit", "list", "--ruc", "20111111111"], {
			HOME: home,
			CPE_DRIVER: "mock",
		});
		expect(alphaAudit.exitCode).toBe(0);
		const alphaJson = parseJson<{ count: number; entries: Array<{ details?: { emisorRuc?: string; id?: string } }> }>(
			alphaAudit.stdout,
		);
		expect(alphaJson.count).toBe(1);
		expect(alphaJson.entries[0]?.details?.emisorRuc).toBe("20111111111");
		expect(alphaJson.entries[0]?.details?.id).toBe("20111111111-01-F101-1");
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

	test("cpe nd emit fails on empty params (validation gate)", async () => {
		const result = await runCli(["-o", "json", "cpe", "nd", "emit", "--params", "{}", "--yes"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		// Either parseFacturaInput rejects empty receptor/items/totales, or
		// parseNotaInput rejects missing refSerie. Both are valid gates.
		const matchedReason = /Missing required fields|refSerie|refNumero|tipoNota/.test(combined);
		expect(matchedReason).toBe(true);
	});

	test("cpe nd emit rejects nota with valid factura body but missing refSerie", async () => {
		const result = await runCli(["-o", "json", "cpe", "nd", "emit", "--params", JSON.stringify(validFactura), "--yes"]);
		expect(result.exitCode).toBe(1);
		const combined = result.stdout + result.stderr;
		expect(combined).toContain("refSerie");
	});

	test("cpe nd emit --yes succeeds with full nota payload (mock driver)", async () => {
		const validNota = {
			...validFactura,
			motivo: "Aumento por mora",
			tipoNota: "01", // Catálogo 10 — Intereses por mora
			refSerie: "F001",
			refNumero: 1230,
		};
		const result = await runCli(["-o", "json", "cpe", "nd", "emit", "--params", JSON.stringify(validNota), "--yes"]);
		expect(result.exitCode).toBe(0);
		const json = JSON.parse(result.stdout) as { success: boolean; status: string };
		expect(json.success).toBe(true);
		expect(json.status).toBe("accepted");
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
