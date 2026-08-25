import { describe, expect, test } from "bun:test";

const BIN = new URL("../../bin/sunat.ts", import.meta.url).pathname;

async function run(args: string[]): Promise<string> {
	const proc = Bun.spawn(["bun", "run", BIN, ...args], { stdout: "pipe", stderr: "ignore" });
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out;
}

describe("a terminal run is not the machine contract", () => {
	// -o table is the human branch without needing a pty. A pipe already
	// exercises the machine branch, so the pair covers both directions.
	for (const cmd of [
		["schema", "f616"],
		["tipo-cambio", "cached", "--fecha", "2026-08-20"],
		["cpe", "profile", "list"],
	]) {
		test(`${cmd.join(" ")} renders a human view rather than JSON`, async () => {
			const human = await run([...cmd, "-o", "table"]);
			expect(() => JSON.parse(human)).toThrow();
		});

		test(`${cmd.join(" ")} keeps its machine contract under a pipe`, async () => {
			const piped = await run(cmd);
			const explicit = await run([...cmd, "-o", "json"]);
			expect(piped).toBe(explicit);
			expect(() => JSON.parse(piped)).not.toThrow();
		});
	}
});
