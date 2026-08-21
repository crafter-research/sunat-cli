import { describe, expect, test } from "bun:test";
import { periodoAnual } from "../../src/renta/f709-api.ts";
import { RENTA_API, RENTA_LOGIN_URL } from "../../src/renta/session.ts";
import { outputTable } from "../../src/utils/output.ts";
import { bold, danger, padVisible, setColorOverride, stripAnsi, visibleWidth } from "../../src/utils/style.ts";

describe("F709 period convention", () => {
	// The annual period is {ejercicio}13. Getting this wrong silently returns
	// another period's data rather than erroring, so it is worth pinning.
	test("annual period appends month sentinel 13", () => {
		expect(periodoAnual(2025)).toBe("202513");
		expect(periodoAnual("2024")).toBe("202413");
	});
});

describe("e-renta endpoints", () => {
	test("API base is the declaracionespago scope the token authorizes", () => {
		expect(RENTA_API).toBe("https://e-renta.sunat.gob.pe/v1/recaudacion/declaracionespago/renta");
	});

	test("login lands on /formularios, not the 500-ing /personas loader", () => {
		// e-renta's root redirects to ...declaracionpago/personas?idFormulario=for0709,
		// which answers nginx 500 unconditionally. Regression guard.
		expect(RENTA_LOGIN_URL).toContain("03590141-c69c-438c-a36a-8ee2a3ad9747");
		expect(decodeURIComponent(RENTA_LOGIN_URL)).toContain("declaracionpago/formularios");
		expect(decodeURIComponent(RENTA_LOGIN_URL)).not.toContain("idFormulario=for0709");
	});
});

describe("styling", () => {
	// A test runner has no TTY, so shouldColor() is false and every styling
	// function returns raw text. Without forcing colour on, the escape sequences
	// that break column math never appear in the string being asserted.
	test("styles are inert without a TTY", () => {
		setColorOverride(null);
		expect(bold("Hi")).toBe("Hi");
		setColorOverride(false);
		expect(danger("boom")).toBe("boom");
		setColorOverride(null);
	});

	test("visibleWidth measures screen columns, not string length", () => {
		setColorOverride(true);
		const styled = bold("Hi");
		expect(styled.length).toBeGreaterThan(2);
		expect(visibleWidth(styled)).toBe(2);
		expect(stripAnsi(styled)).toBe("Hi");
		setColorOverride(null);
	});

	test("padVisible aligns styled text to the same width as plain text", () => {
		setColorOverride(true);
		expect(visibleWidth(padVisible(bold("ab"), 6))).toBe(6);
		expect(visibleWidth(padVisible("ab", 6))).toBe(6);
		setColorOverride(null);
	});
});

describe("table alignment with colour forced on", () => {
	function capture(fn: () => void): string[] {
		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => {
			lines.push(args.join(" "));
		};
		try {
			fn();
		} finally {
			console.log = original;
		}
		return lines;
	}

	test("styled cells do not drift the grid", () => {
		setColorOverride(true);
		const lines = capture(() =>
			outputTable(
				["CASILLA", "STATE"],
				[
					["007", bold("yes")],
					["516", "no"],
				],
			),
		);
		setColorOverride(null);

		// Every row must occupy the same visible width, which is the property that
		// .length-based padding silently breaks. Compare the padded lines as they
		// are: trimming trailing space would erase the very padding under test.
		const widths = lines.map((l) => visibleWidth(l));
		expect(new Set(widths).size).toBe(1);

		// And the styled cell really did carry escapes, so this exercised the
		// coloured branch rather than passing trivially.
		expect(lines[2].length).toBeGreaterThan(visibleWidth(lines[2]));
	});

	test("numeric columns right-align", () => {
		setColorOverride(false);
		const lines = capture(() =>
			outputTable(
				["ORDEN", "NAME"],
				[
					["7", "a"],
					["1005060735", "b"],
				],
			),
		);
		setColorOverride(null);
		// The short number is pushed right so digits line up on their last column.
		expect(lines[2].startsWith("         7")).toBe(true);
	});
});
