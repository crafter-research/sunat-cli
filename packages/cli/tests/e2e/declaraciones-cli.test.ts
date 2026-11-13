import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { stdout, stderr, exitCode: await proc.exited };
}

describe("sunat-cli declaraciones", () => {
	test("help exposes the read-only list and constancia commands", async () => {
		const { stdout, exitCode } = await run(["declaraciones", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("list");
		expect(stdout).toContain("constancia");
		expect(stdout).toContain("does not file, pay or amend");
	});

	test("schema publishes the read-only boundary and limitations", async () => {
		const { stdout, exitCode } = await run(["-o", "json", "schema", "declaraciones"]);
		expect(exitCode).toBe(0);
		const schema = JSON.parse(stdout);
		expect(schema.version).toBe("1.0.0");
		expect(schema.boundaries.filing).toBe("not implemented, by design");
		expect(schema.boundaries.pagination).toContain("100-page bound");
	});

	test("rejects invalid list inputs before opening the portal", async () => {
		const { stdout, stderr, exitCode } = await run([
			"-o",
			"json",
			"declaraciones",
			"list",
			"--desde",
			"2026-08-01",
			"--hasta",
			"30/08/2026",
		]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toBe("");
		expect(JSON.parse(stderr).code).toBe("bad-date");
	});

	test("rejects an invalid order number before opening the portal", async () => {
		const { stdout, stderr, exitCode } = await run([
			"-o",
			"json",
			"declaraciones",
			"constancia",
			"not-an-order",
			"--formulario",
			"0601",
		]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toBe("");
		expect(JSON.parse(stderr).code).toBe("bad-num-orden");
	});
});
