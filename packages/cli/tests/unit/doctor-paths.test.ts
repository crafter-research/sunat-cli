import { describe, expect, test } from "bun:test";
import { paths } from "../../src/data/config.ts";

describe("doctor reads paths that exist", () => {
	test("every path doctor inspects is a string, not undefined", () => {
		// existsSync(undefined) does not throw, it warns and returns false, so a
		// typo in a field name reads as "not configured" forever rather than as
		// an error. paths.configFile was such a typo and reported a present
		// config as missing on every run.
		expect(typeof paths.config).toBe("string");
		expect(paths.config.length).toBeGreaterThan(0);
	});

	test("paths has no configFile field, which is the name that was wrong", () => {
		expect("configFile" in paths).toBe(false);
	});
});
