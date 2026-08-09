import { describe, expect, test } from "bun:test";

// Mirror of periodoToMMYYYY from src/plataforma/f616-api.ts. Kept in the test to
// pin the contract SUNAT's API expects: MMYYYY with no separator.
function periodoToMMYYYY(periodo: string): string {
	const digits = periodo.replace(/[^0-9]/g, "");
	if (/^\d{4}\d{2}$/.test(digits) && periodo.includes("-")) return digits.slice(4) + digits.slice(0, 4);
	if (/^\d{6}$/.test(digits)) return digits;
	throw new Error(`Unrecognized periodo "${periodo}".`);
}

describe("F616 periodo formatting", () => {
	test("YYYY-MM becomes MMYYYY", () => {
		expect(periodoToMMYYYY("2026-03")).toBe("032026");
		expect(periodoToMMYYYY("2025-12")).toBe("122025");
	});

	test("already MMYYYY passes through", () => {
		expect(periodoToMMYYYY("032026")).toBe("032026");
	});

	test("garbage throws", () => {
		expect(() => periodoToMMYYYY("march")).toThrow();
	});
});
