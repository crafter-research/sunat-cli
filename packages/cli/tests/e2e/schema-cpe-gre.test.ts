import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

/**
 * Bun.spawn gives the child pipes rather than a terminal, so `auto` resolves to
 * json. That matches the non-TTY / agent path the schema command cares about.
 */
async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe("schema cpe-gre", () => {
	test("returns valid JSON with expected top-level keys", async () => {
		const { stdout, exitCode } = await run(["schema", "cpe-gre"]);
		expect(exitCode).toBe(0);
		const doc = JSON.parse(stdout);
		expect(doc.command).toBe("cpe gre emit");
		expect(doc.version).toBe("1.0.0");
		expect(doc.fields).toBeDefined();
		expect(doc.flags).toBeDefined();
	});

	test("fields include the three required top-level GRE sections", async () => {
		const { stdout } = await run(["schema", "cpe-gre"]);
		const doc = JSON.parse(stdout);
		expect(doc.fields.destinatario).toBeDefined();
		expect(doc.fields.envio).toBeDefined();
		expect(doc.fields.items).toBeDefined();
		expect(doc.fields.fechaEmision.required).toBe(true);
		expect(doc.fields.fechaEmision.default).toBeUndefined();
		expect(doc.fields.destinatario.properties.tipoDoc.required).toBe(true);
		expect(doc.fields.envio.properties.partida.properties.ubigeo.required).toBe(true);
		expect(doc.fields.items.items.descripcion.required).toBe(true);
	});

	test("-o json produces identical output to pipe-default", async () => {
		const piped = await run(["schema", "cpe-gre"]);
		const explicit = await run(["-o", "json", "schema", "cpe-gre"]);
		expect(explicit.stdout).toBe(piped.stdout);
	});

	test("human-readable output includes field names and header", async () => {
		// Force human (table) output because piped stdout resolves auto to json.
		const { stdout, exitCode } = await run(["-o", "table", "schema", "cpe-gre"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("cpe gre emit");
		expect(stdout).toContain("Field");
		expect(stdout).toContain("destinatario");
		expect(stdout).toContain("envio");
		expect(stdout).toContain("items");
	});
});

describe("schema unknown", () => {
	test("exits non-zero for an unknown schema", async () => {
		const { exitCode, stderr } = await run(["schema", "nonexistent"]);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Unknown schema");
	});

	test("lists cpe-gre among available schemas in the error message", async () => {
		const { stderr } = await run(["schema", "nonexistent"]);
		expect(stderr).toContain("cpe-gre");
	});
});
