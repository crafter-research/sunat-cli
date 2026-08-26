import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

/**
 * Every run here is `--dry-run`. These commands file real tax documents with
 * SUNAT, and dry-run exercises the flag parsing, which is the whole subject.
 *
 * Bun.spawn gives the child pipes rather than a terminal, so `auto` resolves to
 * json. That is the case an agent or a redirect produces, and the one where
 * mixing diagnostics into stdout would do real damage.
 */
async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	await proc.exited;
	return { stdout, stderr };
}

const RHE_PAYLOAD = JSON.stringify({
	empresa: "Cliente Ejemplo",
	tipoDoc: "SIN DOCUMENTO",
	descripcion: "Servicios de desarrollo",
	monto: 1000,
	moneda: "PEN",
	medioPago: "TRANSFERENCIA",
});

const F616_PAYLOAD = JSON.stringify({ periodo: "2026-03", telefono: "999888777", profesion: "01" });

const CASES = [
	{ name: "rhe emit", args: ["rhe", "emit"], payload: RHE_PAYLOAD, marker: "would-emit" },
	{ name: "f616 declare", args: ["f616", "declare"], payload: F616_PAYLOAD, marker: "would-declare" },
] as const;

describe.each(CASES)("$name input flag", ({ args, payload, marker }) => {
	test("--params carries the payload", async () => {
		const { stdout } = await run([...args, "--params", payload, "--dry-run"]);
		expect(stdout).toContain(marker);
	});

	test("--params emits no deprecation", async () => {
		const { stderr } = await run([...args, "--params", payload, "--dry-run"]);
		expect(stderr).not.toContain("deprecated");
	});

	test("--json still carries the payload", async () => {
		const { stdout } = await run([...args, "--json", payload, "--dry-run"]);
		expect(stdout).toContain(marker);
	});

	test("--json warns on stderr, naming the replacement", async () => {
		const { stderr } = await run([...args, "--json", payload, "--dry-run"]);
		expect(stderr).toContain("--json is deprecated");
		expect(stderr).toContain("--params");
	});

	/**
	 * The point of the rename: a caller redirecting stdout must get the same
	 * bytes from either spelling, so the notice cannot leak into parsed data.
	 */
	test("stdout is byte-identical across both spellings", async () => {
		const viaParams = await run([...args, "--params", payload, "--dry-run"]);
		const viaJson = await run([...args, "--json", payload, "--dry-run"]);
		expect(viaJson.stdout).toBe(viaParams.stdout);
	});

	test("the deprecation never reaches stdout", async () => {
		const { stdout } = await run([...args, "--json", payload, "--dry-run"]);
		expect(stdout).not.toContain("deprecated");
	});

	/**
	 * Both passed: --params wins. Deterministic, matches the precedence the cpe
	 * namespace documents, and keeps a caller mid-migration working.
	 */
	test("--params wins when both are passed", async () => {
		const { stdout } = await run([...args, "--params", payload, "--json", "{}", "--dry-run"]);
		const viaParams = await run([...args, "--params", payload, "--dry-run"]);
		expect(stdout).toBe(viaParams.stdout);
	});

	test("both passed still warns, and says the --json value was ignored", async () => {
		const { stderr } = await run([...args, "--params", payload, "--json", "{}", "--dry-run"]);
		expect(stderr).toContain("--json is deprecated");
		expect(stderr).toContain("ignored");
	});

	test("--help documents --params and marks --json deprecated", async () => {
		const { stdout } = await run([...args, "--help"]);
		expect(stdout).toContain("--params <json>");
		expect(stdout).toMatch(/--json <payload>\s+Deprecated alias for --params/);
	});

	test("neither flag points the caller at --params", async () => {
		const { stderr } = await run([...args, "--dry-run"]);
		expect(stderr).toContain("--params");
		expect(stderr).not.toContain("Provide --json");
	});
});

describe("deprecation notice shape", () => {
	test("machine mode emits one parseable JSON line on stderr", async () => {
		const { stderr } = await run(["-o", "json", "rhe", "emit", "--json", RHE_PAYLOAD, "--dry-run"]);
		const line = stderr.split("\n").find((l) => l.includes('"deprecation"'));
		expect(line).toBeDefined();

		const parsed = JSON.parse(line as string);
		expect(parsed.type).toBe("deprecation");
		expect(parsed.deprecated).toBe("--json");
		expect(parsed.replacement).toBe("--params");
		expect(parsed.ignored).toBe(false);
	});

	test("machine mode reports ignored when both are passed", async () => {
		const { stderr } = await run(["-o", "json", "rhe", "emit", "--params", RHE_PAYLOAD, "--json", "{}", "--dry-run"]);
		const line = stderr.split("\n").find((l) => l.includes('"deprecation"'));
		expect(JSON.parse(line as string).ignored).toBe(true);
	});

	test("fires once per invocation, not once per read", async () => {
		const { stderr } = await run(["rhe", "emit", "--json", RHE_PAYLOAD, "--dry-run"]);
		expect(stderr.match(/--json is deprecated/g)).toHaveLength(1);
	});
});

describe("RHE live boundary", () => {
	test("requires both live acknowledgements before opening SUNAT", async () => {
		const { stderr } = await run(["rhe", "emit", "--params", RHE_PAYLOAD]);
		expect(stderr).toContain("requires both --yes and --live-sunat");
	});

	test("documents the portal preview and live acknowledgements", async () => {
		const { stdout } = await run(["rhe", "emit", "--help"]);
		expect(stdout).toContain("--preview-only");
		expect(stdout).toContain("--artifacts-dir <dir>");
		expect(stdout).toContain("--yes");
		expect(stdout).toContain("--live-sunat");
	});

	test("publishes the artifact-aware RHE contract as schema v3", async () => {
		const { stdout } = await run(["schema", "rhe"]);
		expect(JSON.parse(stdout).version).toBe("3.0.0");
	});

	test("rejects unsupported document-backed recipients during dry-run", async () => {
		const payload = JSON.stringify({ ...JSON.parse(RHE_PAYLOAD), tipoDoc: "RUC" });
		const { stderr } = await run(["rhe", "emit", "--params", payload, "--dry-run"]);
		expect(stderr).toContain("supports tipoDoc SIN DOCUMENTO only");
	});

	test("disables live batch emission before reading the CSV", async () => {
		const { stderr } = await run(["rhe", "emit", "--batch", "missing.csv", "--yes", "--live-sunat"]);
		expect(stderr).toContain("Live RHE batch emission is disabled");
	});
});
