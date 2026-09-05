import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

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

const COMMAND_CASES = [
	{ name: "cpe factura preview", command: ["cpe", "factura", "preview"], schema: "cpe-factura" },
	{ name: "cpe factura emit", command: ["cpe", "factura", "emit", "--yes"], schema: "cpe-factura" },
	{ name: "cpe boleta preview", command: ["cpe", "boleta", "preview"], schema: "cpe-boleta" },
	{ name: "cpe boleta emit", command: ["cpe", "boleta", "emit", "--yes"], schema: "cpe-boleta" },
	{ name: "cpe boleta queue", command: ["cpe", "boleta", "queue"], schema: "cpe-boleta" },
	{ name: "cpe nc emit", command: ["cpe", "nc", "emit", "--yes"], schema: "cpe-nota-credito" },
	{ name: "cpe nd emit", command: ["cpe", "nd", "emit", "--yes"], schema: "cpe-nota-credito" },
	{ name: "cpe gre emit", command: ["cpe", "gre", "emit", "--dry-run"], schema: "cpe-gre" },
	{ name: "cpe baja send", command: ["cpe", "baja", "send", "--yes"], schema: undefined },
	{ name: "rhe emit", command: ["rhe", "emit", "--dry-run"], schema: "rhe" },
	{ name: "f616 declare", command: ["f616", "declare", "--dry-run"], schema: "f616" },
] as const;

describe("Invalid JSON diagnostics for --params across commands", () => {
	for (const { name, command, schema } of COMMAND_CASES) {
		describe(name, () => {
			test("malformed JSON in machine mode outputs structured error with INVALID_PARAMS_JSON code", async () => {
				const result = await runCli(["-o", "json", ...command, "--params", "{ malformed json: true"]);
				expect(result.exitCode).toBe(1);
				expect(result.stdout.trim()).toBe("");

				// Never prints an unhandled SyntaxError stack trace
				expect(result.stderr).not.toContain("SyntaxError:");
				expect(result.stderr).not.toContain("at JSON.parse");

				// Stderr is valid structured JSON
				const parsed = JSON.parse(result.stderr) as { success: boolean; error: string; code?: string };
				expect(parsed.success).toBe(false);
				expect(parsed.code).toBe("INVALID_PARAMS_JSON");
				expect(parsed.error).toBe("Invalid JSON in --params.");
			});

			test("malformed JSON in human mode shows concise error and schema pointer", async () => {
				const result = await runCli(["-o", "table", ...command, "--params", "not json at all"]);
				expect(result.exitCode).toBe(1);

				// Message identifies --params and stable code
				expect(result.stderr).toContain("Error");
				expect(result.stderr).toContain("INVALID_PARAMS_JSON");
				expect(result.stderr).toContain("Invalid JSON in --params.");

				// Never prints an unhandled SyntaxError stack trace
				expect(result.stderr).not.toContain("SyntaxError:");
				expect(result.stderr).not.toContain("at JSON.parse");

				// Diagnostic points to the matching schema resource if one exists
				if (schema) {
					expect(result.stderr).toContain(`sunat-cli schema ${schema}`);
				}
			});
		});
	}

	test("rhe emit with deprecated --json flag handles malformed JSON cleanly", async () => {
		const result = await runCli(["-o", "json", "rhe", "emit", "--dry-run", "--json", "{ bad json"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).not.toContain("SyntaxError:");
		expect(result.stderr).toContain("INVALID_PARAMS_JSON");
	});

	test("f616 declare with deprecated --json flag handles malformed JSON cleanly", async () => {
		const result = await runCli(["-o", "json", "f616", "declare", "--dry-run", "--json", "{ bad json"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).not.toContain("SyntaxError:");
		expect(result.stderr).toContain("INVALID_PARAMS_JSON");
	});

	test("valid JSON with missing fields keeps current validation error behavior", async () => {
		// Valid JSON with missing factura fields
		const facturaResult = await runCli(["-o", "json", "cpe", "factura", "preview", "--params", "{}"]);
		expect(facturaResult.exitCode).toBe(1);
		const facturaParsed = JSON.parse(facturaResult.stderr);
		expect(facturaParsed.error).toContain("Missing required fields. Run: sunat-cli schema cpe-factura");

		// Valid JSON with missing baja fields
		const bajaResult = await runCli(["-o", "json", "cpe", "baja", "send", "--yes", "--params", "{}"]);
		expect(bajaResult.exitCode).toBe(1);
		const bajaParsed = JSON.parse(bajaResult.stderr);
		expect(bajaParsed.error).toContain("baja requires fechaEmisionDocs");

		// Valid JSON with missing GRE fields
		const greResult = await runCli(["-o", "json", "cpe", "gre", "emit", "--dry-run", "--params", "{}"]);
		expect(greResult.exitCode).toBe(1);
		const greParsed = JSON.parse(greResult.stderr);
		expect(greParsed.error).toContain("GRE requires destinatario, envio, items");
	});
});
