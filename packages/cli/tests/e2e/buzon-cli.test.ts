import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = new URL("../../bin/sunat.ts", import.meta.url).pathname;
const homes: string[] = [];

async function run(args: string[], state?: Record<string, unknown>) {
	const home = mkdtempSync(join(tmpdir(), "sunat-buzon-e2e-"));
	homes.push(home);
	const sunatHome = join(home, ".sunat");
	if (state) {
		mkdirSync(join(sunatHome, "buzon"), { recursive: true, mode: 0o700 });
		writeFileSync(join(sunatHome, "buzon", "state.json"), `${JSON.stringify(state)}\n`, { mode: 0o600 });
	}
	const process = Bun.spawn(["bun", "run", BIN, ...args], {
		env: { ...globalThis.process.env, HOME: home, SUNAT_HOME: sunatHome },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { stdout, stderr, exitCode };
}

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("sunat-cli buzon", () => {
	test("help exposes only list and offline status", async () => {
		const result = await run(["buzon", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("list");
		expect(result.stdout).toContain("status");
		expect(result.stdout).not.toMatch(/^\s+show\s/m);
		expect(result.stdout).not.toMatch(/^\s+attachments?\s/m);
	});

	test("schema buzon publishes the metadata-only boundary", async () => {
		const result = await run(["-o", "json", "schema", "buzon"]);
		expect(result.exitCode).toBe(0);
		const schema = JSON.parse(result.stdout);
		expect(schema.version).toBe("1.0.0");
		expect(schema.boundaries.messageBodies).toBe("not implemented");
		expect(schema.boundaries.polling).toBe("manual invocation only");
	});

	test("list rejects an unsafe pagination bound before opening the portal", async () => {
		const result = await run(["buzon", "list", "--max-pages", "101"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("must be an integer from 1 to 100");
	});

	test("status fails safely when no local snapshot exists", async () => {
		const result = await run(["-o", "json", "buzon", "status"]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toEqual({
			success: false,
			error: "No local Buzón snapshot exists.",
			code: "no-snapshot",
		});
	});

	test("status reads a private snapshot without network or credentials", async () => {
		const state = {
			version: "1.0.0",
			fetchedAt: "2026-08-26T03:00:00.000Z",
			source: "SUNAT Buzón SOL legacy visor",
			readOnlyBoundary: "metadata-only",
			overview: { foldersObserved: 0, alertsObserved: 0 },
			summaries: [
				{
					kind: "message",
					pagesFetched: 1,
					observedCount: 0,
					reportedTotalsObserved: [],
					reportedRecordsObserved: [],
					countMismatch: false,
				},
				{
					kind: "notification",
					pagesFetched: 1,
					observedCount: 0,
					reportedTotalsObserved: [],
					reportedRecordsObserved: [],
					countMismatch: false,
				},
			],
			changes: { baselineCreated: false, newCount: 0, knownCount: 0, missingCount: 0, totalCount: 0 },
			items: [],
		};
		const result = await run(["-o", "json", "buzon", "status"], state);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout).changes).toEqual(state.changes);
		expect(result.stderr).toBe("");
	});
});
