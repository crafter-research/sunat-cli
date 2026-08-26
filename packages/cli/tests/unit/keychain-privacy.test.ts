import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureBin = join(import.meta.dir, "..", "fixtures", "fake-bin");
const probe = join(import.meta.dir, "..", "fixtures", "keychain-privacy-probe.ts");
const temporaryDirs: string[] = [];

afterEach(() => {
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capturePaths(): { args: string; stdin: string; env: string } {
	const dir = mkdtempSync(join(tmpdir(), "sunat-keychain-privacy-"));
	temporaryDirs.push(dir);
	return { args: join(dir, "args"), stdin: join(dir, "stdin"), env: join(dir, "env") };
}

async function runProbe(
	capture: { args: string; stdin: string; env: string },
	options: {
		fail?: boolean;
		secret?: string;
		platform?: "darwin" | "linux" | "win32";
		action?: "set" | "get" | "clear";
	} = {},
): Promise<{ stderr: string; exitCode: number }> {
	chmodSync(join(fixtureBin, "security"), 0o755);
	chmodSync(join(fixtureBin, "secret-tool"), 0o755);
	chmodSync(join(fixtureBin, "powershell.exe"), 0o755);
	const proc = Bun.spawn(["bun", "run", probe], {
		env: {
			...process.env,
			PATH: `${fixtureBin}:${process.env.PATH || ""}`,
			SUNAT_TEST_KEYCHAIN_ARGS: capture.args,
			SUNAT_TEST_KEYCHAIN_STDIN: capture.stdin,
			SUNAT_TEST_KEYCHAIN_ENV: capture.env,
			SUNAT_TEST_KEYCHAIN_FAIL: options.fail ? "1" : "0",
			SUNAT_TEST_KEYCHAIN_EXIT_CODE: "2",
			SUNAT_TEST_KEYCHAIN_ERROR: "private-clave-sol",
			SUNAT_TEST_KEYCHAIN_SECRET: options.secret || "private-clave-sol",
			SUNAT_TEST_KEYCHAIN_PLATFORM: options.platform || "darwin",
			SUNAT_TEST_KEYCHAIN_ACTION: options.action || "set",
			SUNAT_PASSWORD: "ambient-private-clave-sol",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	return { stderr, exitCode };
}

describe("keychain input privacy", () => {
	test("rejects line breaks before invoking the backend", async () => {
		const capture = capturePaths();
		const result = await runProbe(capture, { secret: "line-one\nline-two" });

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Secret value cannot contain line breaks.");
		expect(existsSync(capture.args)).toBe(false);
	});

	test("passes macOS secrets through stdin instead of process arguments", async () => {
		const capture = capturePaths();
		const result = await runProbe(capture);

		expect(result).toEqual({ stderr: "", exitCode: 0 });
		expect(readFileSync(capture.args, "utf8")).not.toContain("private-clave-sol");
		expect(readFileSync(capture.args, "utf8").trim().endsWith("-w")).toBe(true);
		expect(readFileSync(capture.stdin, "utf8")).toBe("private-clave-sol\nprivate-clave-sol");
		expect(readFileSync(capture.env, "utf8")).toBe("");
	});

	test("does not echo keychain stderr when storing fails", async () => {
		const capture = capturePaths();
		const result = await runProbe(capture, { fail: true });

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Could not store SUNAT_PASSWORD in macOS Keychain.");
		expect(result.stderr).not.toContain("private-clave-sol");
	});

	test("passes Linux Secret Service values through stdin instead of process arguments", async () => {
		const capture = capturePaths();
		const result = await runProbe(capture, { platform: "linux" });

		expect(result).toEqual({ stderr: "", exitCode: 0 });
		expect(readFileSync(capture.args, "utf8")).not.toContain("private-clave-sol");
		expect(readFileSync(capture.stdin, "utf8")).toBe("private-clave-sol");
		expect(readFileSync(capture.env, "utf8")).toBe("");
	});

	test("passes Windows Credential Manager values through stdin instead of process arguments", async () => {
		const capture = capturePaths();
		const result = await runProbe(capture, { platform: "win32" });

		expect(result).toEqual({ stderr: "", exitCode: 0 });
		expect(readFileSync(capture.args, "utf8")).not.toContain("private-clave-sol");
		expect(readFileSync(capture.args, "utf8")).toContain("-EncodedCommand");
		expect(readFileSync(capture.stdin, "utf8")).toBe("private-clave-sol");
		expect(readFileSync(capture.env, "utf8")).toBe("");
	});

	for (const action of ["get", "clear"] as const) {
		test(`does not echo keychain stderr when ${action} fails`, async () => {
			const capture = capturePaths();
			const result = await runProbe(capture, { fail: true, action });

			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain(`Could not ${action === "get" ? "read" : "clear"} SUNAT_PASSWORD`);
			expect(result.stderr).not.toContain("private-clave-sol");
		});
	}
});
