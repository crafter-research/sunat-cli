import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");
const tempHomes: string[] = [];

interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

function createTempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "sunat-audit-test-"));
	tempHomes.push(home);
	mkdirSync(join(home, ".sunat", "audit"), { recursive: true });
	return home;
}

async function runCli(args: string[], home: string): Promise<CliResult> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, HOME: home, SUNAT_HOME: join(home, ".sunat"), CPE_DRIVER: "mock" },
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

afterEach(() => {
	for (const home of tempHomes.splice(0)) {
		rmSync(home, { recursive: true, force: true });
	}
});

describe("sunat audit — E2E", () => {
	test("audit compact archives old active months and keeps recent monthly logs active", async () => {
		const home = createTempHome();
		const auditDir = join(home, ".sunat", "audit");
		const currentMonth = new Date().toISOString().slice(0, 7);

		writeFileSync(
			join(auditDir, "2000-01.jsonl"),
			'{"timestamp":"2000-01-01T00:00:00.000Z","command":"rhe emit","args":{"ruc":"20123456789"},"result":"success"}\n',
		);
		writeFileSync(
			join(auditDir, "2000-01-15.jsonl"),
			'{"timestamp":"2000-01-15T00:00:00.000Z","command":"f616 declare","args":{"name":"Private Person"},"result":"success"}\n',
		);
		writeFileSync(
			join(auditDir, `${currentMonth}.jsonl`),
			`{"timestamp":"${currentMonth}-01T00:00:00.000Z","command":"current","args":{},"result":"success"}\n`,
		);

		const result = await runCli(["-o", "json", "audit", "compact"], home);
		expect(result.exitCode).toBe(0);

		const json = JSON.parse(result.stdout) as { compactedMonths: string[]; archivePaths: string[] };
		expect(json.compactedMonths).toContain("2000-01");
		expect(existsSync(join(auditDir, "2000-01.jsonl"))).toBe(false);
		expect(existsSync(join(auditDir, "2000-01-15.jsonl"))).toBe(false);
		expect(existsSync(join(auditDir, `${currentMonth}.jsonl`))).toBe(true);
		expect(json.archivePaths).toContain(join(auditDir, "archive", "2000-01.jsonl.gz"));

		const archived = gunzipSync(readFileSync(join(auditDir, "archive", "2000-01.jsonl.gz"))).toString("utf-8");
		expect(archived).toContain("rhe emit");
		expect(archived).toContain("f616 declare");
		expect(archived).not.toContain("20123456789");
		expect(archived).not.toContain("Private Person");
	});

	test("audit prune deletes archived months strictly before the cutoff", async () => {
		const home = createTempHome();
		const archiveDir = join(home, ".sunat", "audit", "archive");
		mkdirSync(archiveDir, { recursive: true });

		writeFileSync(join(archiveDir, "2000-01.jsonl.gz"), gzipSync('{"entry":"old"}\n'));
		writeFileSync(join(archiveDir, "2001-02.jsonl.gz"), gzipSync('{"entry":"keep"}\n'));

		const result = await runCli(["-o", "json", "audit", "prune", "--before", "2001-02"], home);
		expect(result.exitCode).toBe(0);

		const json = JSON.parse(result.stdout) as { prunedMonths: string[] };
		expect(json.prunedMonths).toEqual(["2000-01"]);
		expect(existsSync(join(archiveDir, "2000-01.jsonl.gz"))).toBe(false);
		expect(existsSync(join(archiveDir, "2001-02.jsonl.gz"))).toBe(true);
	});
});
