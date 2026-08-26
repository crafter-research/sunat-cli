import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { probeAgentBrowser } from "../../src/browser/dependency.ts";

const temporaryDirs: string[] = [];

afterEach(() => {
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test.skipIf(process.platform !== "win32")("resolves the npm agent-browser.cmd shim on Windows", () => {
	const fixtureBin = mkdtempSync(join(tmpdir(), "sunat-agent-browser-cmd-"));
	temporaryDirs.push(fixtureBin);
	writeFileSync(join(fixtureBin, "agent-browser.cmd"), "@echo off\r\necho agent-browser windows shim 1.0\r\n");
	const pathName = Object.keys(process.env).find((name) => name.toLowerCase() === "path") || "PATH";
	const path = `${fixtureBin}${delimiter}${process.env[pathName] || ""}`;
	expect(probeAgentBrowser({ ...process.env, [pathName]: path })).toEqual({
		installed: true,
		version: "agent-browser windows shim 1.0",
	});
});
