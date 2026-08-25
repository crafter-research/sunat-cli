import { describe, expect, test } from "bun:test";
import {
	AGENT_BROWSER_INSTALL,
	isMissingBinary,
	missingBinaryError,
	probeAgentBrowser,
} from "../../src/browser/dependency.ts";

describe("agent-browser as a declared dependency", () => {
	test("ENOENT is recognised as a missing binary", () => {
		const err = new Error("spawn agent-browser ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		expect(isMissingBinary(err)).toBe(true);
	});

	test("other spawn failures are not mistaken for a missing binary", () => {
		const err = new Error("boom") as NodeJS.ErrnoException;
		err.code = "EACCES";
		expect(isMissingBinary(err)).toBe(false);
		expect(isMissingBinary(undefined)).toBe(false);
	});

	test("the error names the cause and every install route", () => {
		const msg = missingBinaryError().message;
		expect(msg).toContain("agent-browser is not installed");
		expect(msg).toContain("npm install -g agent-browser");
		expect(msg).toContain("brew install agent-browser");
		expect(msg).toContain("agent-browser install");
		expect(msg).toContain("npx agent-browser");
	});

	test("the error carries a code a caller can branch on", () => {
		expect((missingBinaryError() as NodeJS.ErrnoException).code).toBe("AGENT_BROWSER_MISSING");
	});

	test("every install route appears exactly once", () => {
		for (const route of ["npm install -g", "brew install", "agent-browser install"]) {
			expect(AGENT_BROWSER_INSTALL.split(route).length - 1).toBe(1);
		}
	});

	test("the probe answers without throwing, installed or not", () => {
		const status = probeAgentBrowser();
		expect(typeof status.installed).toBe("boolean");
		if (!status.installed) expect(status.hint).toBeTruthy();
	});
});
