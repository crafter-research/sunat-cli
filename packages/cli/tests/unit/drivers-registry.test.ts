import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDriver, MockDriver } from "../../src/cpe/drivers/index.ts";

const STUB_DRIVERS = ["facturador", "sunat-direct", "nubefact", "apisperu"] as const;

describe("getDriver", () => {
	const original = process.env.CPE_DRIVER;

	beforeEach(() => {
		delete process.env.CPE_DRIVER;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.CPE_DRIVER;
		else process.env.CPE_DRIVER = original;
	});

	test("default (no arg, no env) returns MockDriver", () => {
		const d = getDriver(undefined);
		expect(d).toBeInstanceOf(MockDriver);
	});

	test('"mock" returns MockDriver', () => {
		const d = getDriver("mock");
		expect(d).toBeInstanceOf(MockDriver);
	});

	test("CPE_DRIVER env var is honored when arg is undefined", () => {
		process.env.CPE_DRIVER = "mock";
		const d = getDriver(undefined);
		expect(d).toBeInstanceOf(MockDriver);
	});

	test("explicit arg overrides env", () => {
		process.env.CPE_DRIVER = "facturador";
		const d = getDriver("mock");
		expect(d).toBeInstanceOf(MockDriver);
	});

	for (const name of STUB_DRIVERS) {
		test(`"${name}" throws clear unimplemented error`, () => {
			expect(() => getDriver(name)).toThrow(/shaped but not implemented/);
		});
	}

	test("unknown driver name throws with available list", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
		expect(() => getDriver("nonexistent" as any)).toThrow(/Unknown driver/);
	});
});
