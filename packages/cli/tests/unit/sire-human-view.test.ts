import { describe, expect, test } from "bun:test";
import { fmtEstado, fmtPeriodo } from "../../src/commands/sire/index.ts";
import { setColorOverride, stripAnsi } from "../../src/utils/style.ts";

const DANGER = "38;5;203";
const MUTED = "38;5;245";

describe("sire periodo formatting", () => {
	// `202504` is a key, not a date: the separator does the segmenting once.
	test("a six-digit periodo reads as year and month", () => {
		expect(fmtPeriodo("202504")).toBe("2025-04");
		expect(fmtPeriodo("202412")).toBe("2024-12");
	});

	test("anything that is not six digits is passed through untouched", () => {
		expect(fmtPeriodo("2025")).toBe("2025");
		expect(fmtPeriodo("")).toBe("");
		expect(fmtPeriodo("20250412")).toBe("20250412");
	});

	// SUNAT's own `desEstado` is printed verbatim: the `codEstado` catalogue is
	// contradictory in this repo (the type says "01 presentado", the captured
	// fixture pairs "01" with "Pendiente"), so mapping it would risk a label that
	// reads backwards.
	test("the server's own description is printed verbatim", () => {
		setColorOverride(false);
		expect(fmtEstado("Presentado")).toBe("Presentado");
		expect(fmtEstado("  Pendiente  ")).toBe("Pendiente");
		setColorOverride(null);
	});

	test("a missing estado degrades to muted context, never to a red error", () => {
		setColorOverride(true);
		expect(fmtEstado(undefined)).toContain(MUTED);
		expect(fmtEstado(undefined)).not.toContain(DANGER);
		expect(stripAnsi(fmtEstado(""))).toBe("sin estado");
		setColorOverride(null);
	});
});
