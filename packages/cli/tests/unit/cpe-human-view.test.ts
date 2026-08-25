import { describe, expect, test } from "bun:test";
import { describeDriver, doctorNextSteps, formatCheck, styleMode } from "../../src/commands/cpe/index.ts";
import type { DoctorReport, DriverInfo } from "../../src/cpe/drivers/types.ts";
import { setColorOverride, stripAnsi, visibleWidth } from "../../src/utils/style.ts";

const DANGER = "38;5;203";
const OK = "38;5;78";
const INFO = "38;5;75";
const MUTED = "38;5;245";

const mockInfo: DriverInfo = { name: "mock", mode: "sandbox", version: "0.1.0", endpoint: "memory://" };

function report(over: Partial<DoctorReport>): DoctorReport {
	return { driver: mockInfo, ok: true, checks: [], ...over };
}

describe("cpe driver description", () => {
	// A reader told "healthy" needs to know the answer came from memory rather
	// than the wire, which is the only thing that separates the two drivers here.
	test("mock says nothing is sent, real drivers name the endpoint they reach", () => {
		expect(describeDriver(mockInfo)).toBe("nothing is sent to SUNAT");
		expect(describeDriver({ ...mockInfo, name: "sunat-direct" })).toBe("sandbox endpoint");
		expect(describeDriver({ ...mockInfo, name: "sunat-direct", mode: "prod" })).toBe("live endpoint");
	});

	test("prod is the state a reader must not miss, and sandbox is not an error", () => {
		setColorOverride(true);
		expect(styleMode("prod")).toContain(INFO);
		expect(styleMode("sandbox")).toContain(MUTED);
		// A sandbox is a safe default, not a failure: danger stays for errors.
		expect(styleMode("sandbox")).not.toContain(DANGER);
		expect(styleMode("prod")).not.toContain(DANGER);
		setColorOverride(null);
	});
});

describe("cpe doctor check lines", () => {
	test("glyph and colour agree, so a passing check never reads as a failure", () => {
		setColorOverride(true);
		const pass = formatCheck({ name: "driver_loaded", ok: true }, 13);
		const fail = formatCheck({ name: "cert_loaded", ok: false }, 13);
		expect(pass).toContain("✓");
		expect(pass).toContain(OK);
		expect(pass).not.toContain(DANGER);
		// A failed check in a health report is the error state, which is what
		// danger exists for.
		expect(fail).toContain("✗");
		expect(fail).toContain(DANGER);
		expect(fail).not.toContain(OK);
		setColorOverride(null);
	});

	// The bug this guards: padding a styled label with `.length` over-pads by the
	// size of the escapes, so the detail column drifts once colour is on.
	test("check names stay aligned by visible width even when styled", () => {
		setColorOverride(true);
		const width = 13;
		const lines = [
			formatCheck({ name: "driver_loaded", ok: true, detail: "@" }, width),
			formatCheck({ name: "no_network", ok: false, detail: "@" }, width),
		];
		const detailColumns = lines.map((l) => stripAnsi(l).indexOf("@"));
		expect(detailColumns[0]).toBe(detailColumns[1]);
		// And the styled string really is longer than what the terminal draws,
		// which is exactly why `.length` would have been wrong.
		expect(lines[1].length).toBeGreaterThan(visibleWidth(lines[1]));
		setColorOverride(null);
	});

	test("styling leaves the words intact so NO_COLOR loses nothing but colour", () => {
		setColorOverride(true);
		expect(stripAnsi(formatCheck({ name: "cert_loaded", ok: false, detail: "expired" }, 11))).toBe(
			"  ✗ cert_loaded  expired",
		);
		setColorOverride(false);
		expect(formatCheck({ name: "cert_loaded", ok: true }, 0)).toBe("  ✓ cert_loaded");
		setColorOverride(null);
	});
});

describe("cpe doctor next steps", () => {
	// An emitted command is an executable promise, so a healthy report that has
	// nothing safe to suggest emits nothing at all.
	test("a healthy real driver suggests nothing", () => {
		expect(doctorNextSteps(report({ driver: { ...mockInfo, name: "sunat-direct" }, ok: true }))).toEqual([]);
	});

	test("a healthy mock points at the driver that actually reaches SUNAT", () => {
		const steps = doctorNextSteps(report({ ok: true }));
		expect(steps).toHaveLength(1);
		expect(steps[0].command).toBe("sunat-cli cpe doctor --driver sunat-direct");
	});

	test("a config or certificate failure points at the profile that resolves it", () => {
		const steps = doctorNextSteps(
			report({ ok: false, checks: [{ name: "cert_loaded", ok: false, detail: "expired" }] }),
		);
		expect(steps.map((s) => s.command)).toEqual(["sunat-cli cpe profile list"]);
	});

	test("stale pendings point at the audit log, and only read-only commands are emitted", () => {
		const steps = doctorNextSteps(
			report({
				ok: false,
				checks: [
					{ name: "config_resolved", ok: false },
					{ name: "stale_pendings", ok: false },
				],
			}),
		);
		expect(steps.map((s) => s.command)).toEqual(["sunat-cli cpe profile list", "sunat-cli audit list"]);
		// Nothing emitted here may file, send, or declare anything.
		for (const s of steps) expect(s.command).not.toMatch(/emit|send|declarar|--yes|sync/);
	});
});
