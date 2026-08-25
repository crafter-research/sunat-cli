import { describe, expect, test } from "bun:test";

const BIN = new URL("../../bin/sunat.ts", import.meta.url).pathname;

async function run(args: string[]): Promise<string> {
	const proc = Bun.spawn(["bun", "run", BIN, ...args], { stdout: "pipe", stderr: "ignore" });
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out;
}

describe("skills output under a pipe", () => {
	test("list emits JSON when stdout is not a terminal", async () => {
		const parsed = JSON.parse(await run(["skills", "list"]));
		expect(Array.isArray(parsed.skills)).toBe(true);
		expect(parsed.skills.length).toBeGreaterThan(0);
	});

	test("list under a pipe carries no truncation marker", async () => {
		expect(await run(["skills", "list"])).not.toContain("…");
	});

	test("get still serves the raw document, not JSON", async () => {
		const out = await run(["skills", "get", "core"]);
		expect(out.startsWith("#")).toBe(true);
		expect(() => JSON.parse(out)).toThrow();
	});
});
