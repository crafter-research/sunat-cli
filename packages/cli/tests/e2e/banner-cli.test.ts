import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

/**
 * Bun.spawn gives the child pipes rather than a terminal, so every run here is
 * the non-TTY case. That is exactly the case worth locking: it is the one a
 * redirect or an agent produces, and the one a banner would corrupt.
 *
 * The TTY branch cannot be reached from a test runner and is verified by hand
 * with `script -q /dev/null`.
 */
async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	await proc.exited;
	return { stdout, stderr };
}

describe("banner stream boundary", () => {
	test("--help writes no banner to stdout when stdout is a pipe", async () => {
		const { stdout } = await run(["--help"]);

		expect(stdout).not.toContain("█");
		expect(stdout).not.toContain("sunat-cli v");
		expect(stdout.startsWith("Usage:")).toBe(true);
	});

	test("piped help carries no ANSI at all", async () => {
		const { stdout } = await run(["--help"]);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the absence of escapes is the point
		expect(stdout).not.toMatch(/\x1b\[/);
	});

	test("bare invoke keeps stdout free of the wordmark", async () => {
		const { stdout } = await run([]);
		expect(stdout).not.toContain("█");
	});

	test("machine mode prints no banner on either stream", async () => {
		const { stdout, stderr } = await run(["-o", "json", "--help"]);
		expect(stdout).not.toContain("█");
		expect(stderr).not.toContain("█");
	});
});
