import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];
const PROBE = join(import.meta.dir, "..", "fixtures", "privacy-probe.ts");

async function probe(action: string): Promise<string> {
	const home = mkdtempSync(join(tmpdir(), "sunat-privacy-"));
	homes.push(home);
	const proc = Bun.spawn(["bun", "run", PROBE, action], {
		env: { ...process.env, HOME: home, SUNAT_HOME: join(home, ".sunat") },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(stderr);
	return stdout.trim();
}

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("private local state", () => {
	test("creates config, token and audit state with owner-only permissions", async () => {
		const result = JSON.parse(await probe("permissions"));
		expect(result).toEqual({ dir: 0o700, config: 0o600, audit: 0o600, key: 0o600, marker: 0o600 });
	});

	test("repairs permissive config files when loading them", async () => {
		const result = JSON.parse(await probe("repair"));
		expect(result.mode).toBe(0o600);
		expect(result.config).toEqual({ usuario: "USER" });
		expect(result.stored).not.toContain("legacy-secret");
		expect(result.stored).not.toContain("private person");
	});

	test("keeps caller-owned output directories unchanged while protecting downloaded files", async () => {
		expect(JSON.parse(await probe("output-permissions"))).toEqual({ dir: 0o755, file: 0o600 });
	});

	test("removes inherited macOS ACL access from sensitive files", async () => {
		expect(JSON.parse(await probe("acl"))).toEqual({ hasEveryoneAcl: false });
	});
});

describe("audit minimization", () => {
	test("removes tax identities, documents, secrets, XML and free-form errors", async () => {
		const text = await probe("redaction");
		for (const forbidden of [
			"20123456789",
			"PRIVATE CLIENT SAC",
			"Private consulting",
			"super-secret",
			"<Invoice>",
			"12345678",
			"private@example.com",
			"Future customer alias",
		]) {
			expect(text).not.toContain(forbidden);
		}
		expect(text).toContain('"status":"accepted"');
		expect(text).toContain('"args":{}');
	});

	test("sanitizes active and archived legacy logs before exposing them", async () => {
		const result = JSON.parse(await probe("migrate"));
		for (const text of [result.active, result.archive]) {
			expect(text).not.toContain("PRIVATE CLIENT SAC");
			expect(text).not.toContain("20123456789");
			expect(text).not.toContain("<Invoice/>");
			expect(text).toContain("hmac-sha256:");
		}
		expect(result.activeMode).toBe(0o600);
		expect(result.archiveMode).toBe(0o600);
		expect(result.screenshotExists).toBe(false);
	});

	test("re-sanitizes legacy data created after the privacy marker", async () => {
		const result = JSON.parse(await probe("migrate-after-marker"));
		expect(result.active).not.toContain("PRIVATE CLIENT SAC");
		expect(result.screenshotExists).toBe(false);
	});

	test("uses stable keyed references without exposing the source identifier", async () => {
		const { first, second } = JSON.parse(await probe("reference"));
		expect(first).toBe(second);
		expect(first).not.toContain("20123456789");
	});
});
