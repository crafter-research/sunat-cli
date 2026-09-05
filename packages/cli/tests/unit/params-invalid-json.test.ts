import { describe, expect, test } from "bun:test";
import { parseFacturaInput, parseNotaInput } from "../../src/cpe/parsers.ts";
import { InvalidJsonParamsError, parseJsonParams } from "../../src/utils/params.ts";

describe("parseJsonParams unit tests", () => {
	test("parses valid JSON string into typed object", () => {
		const result = parseJsonParams<{ key: string }>('{"key":"value"}');
		expect(result).toEqual({ key: "value" });
	});

	test("throws InvalidJsonParamsError on malformed JSON", () => {
		expect(() => parseJsonParams("{broken json")).toThrow(InvalidJsonParamsError);
	});

	test("error has stable machine-readable code INVALID_PARAMS_JSON", () => {
		try {
			parseJsonParams("{bad");
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(InvalidJsonParamsError);
			const error = err as InvalidJsonParamsError;
			expect(error.code).toBe("INVALID_PARAMS_JSON");
		}
	});

	test("message identifies --params as the invalid input by default", () => {
		try {
			parseJsonParams("not a json string");
			expect.unreachable();
		} catch (err) {
			const error = err as InvalidJsonParamsError;
			expect(error.message).toBe("Invalid JSON in --params.");
			expect(error.flag).toBe("--params");
		}
	});

	test("message identifies custom flag when specified", () => {
		try {
			parseJsonParams("bad", { flag: "--custom-flag" });
			expect.unreachable();
		} catch (err) {
			const error = err as InvalidJsonParamsError;
			expect(error.message).toBe("Invalid JSON in --custom-flag.");
			expect(error.flag).toBe("--custom-flag");
		}
	});

	test("attaches schema diagnostic hint when schema is provided", () => {
		try {
			parseJsonParams("{invalid", { schema: "cpe-factura" });
			expect.unreachable();
		} catch (err) {
			const error = err as InvalidJsonParamsError;
			expect(error.hint).toBe("Run: sunat-cli schema cpe-factura");
			expect(error.schema).toBe("cpe-factura");
		}
	});

	test("omits schema diagnostic hint when schema is not provided", () => {
		try {
			parseJsonParams("{invalid");
			expect.unreachable();
		} catch (err) {
			const error = err as InvalidJsonParamsError;
			expect(error.hint).toBeUndefined();
			expect(error.schema).toBeUndefined();
		}
	});

	test("parseFacturaInput throws InvalidJsonParamsError with cpe-factura schema hint", () => {
		try {
			parseFacturaInput("not json");
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(InvalidJsonParamsError);
			const error = err as InvalidJsonParamsError;
			expect(error.code).toBe("INVALID_PARAMS_JSON");
			expect(error.hint).toBe("Run: sunat-cli schema cpe-factura");
		}
	});

	test("parseNotaInput throws InvalidJsonParamsError with cpe-nota-credito schema hint", () => {
		try {
			parseNotaInput("not json");
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(InvalidJsonParamsError);
			const error = err as InvalidJsonParamsError;
			expect(error.code).toBe("INVALID_PARAMS_JSON");
			expect(error.hint).toBe("Run: sunat-cli schema cpe-nota-credito");
		}
	});
});
