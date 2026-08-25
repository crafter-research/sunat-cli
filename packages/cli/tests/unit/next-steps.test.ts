import { afterEach, describe, expect, test } from "bun:test";
import { emitNextSteps } from "../../src/utils/next-steps.ts";
import { setColorOverride } from "../../src/utils/style.ts";

const realWrite = process.stderr.write.bind(process.stderr);

function captureStderr(fn: () => void): string {
	let buf = "";
	// @ts-expect-error narrowing the overloads of stderr.write is not worth it here
	process.stderr.write = (chunk: string) => {
		buf += chunk;
		return true;
	};
	try {
		fn();
	} finally {
		process.stderr.write = realWrite;
	}
	return buf;
}

afterEach(() => {
	setColorOverride(null);
});

describe("emitNextSteps", () => {
	test("emits nothing for an empty list", () => {
		expect(captureStderr(() => emitNextSteps([], "json"))).toBe("");
		expect(captureStderr(() => emitNextSteps([], "table"))).toBe("");
	});

	test("json mode writes one NDJSON object per step, tagged for agents", () => {
		const out = captureStderr(() =>
			emitNextSteps(
				[
					{ command: "sunat-cli renta constancia abc123", description: "proof of filing" },
					{ command: "sunat-cli skills get schemas", description: "field specs", optional: true },
				],
				"json",
			),
		);
		const lines = out.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0])).toEqual({
			type: "next-step",
			command: "sunat-cli renta constancia abc123",
			description: "proof of filing",
		});
		expect(JSON.parse(lines[1])).toEqual({
			type: "next-step",
			command: "sunat-cli skills get schemas",
			description: "field specs",
			optional: true,
		});
	});

	test("json mode carries no ANSI escapes even when colour is forced on", () => {
		setColorOverride(true);
		const out = captureStderr(() =>
			emitNextSteps([{ command: "sunat-cli padron sync", description: "cache is stale" }], "json"),
		);
		expect(out).not.toContain("\x1b[");
	});

	test("human mode names the command and marks optional steps differently", () => {
		setColorOverride(false);
		const out = captureStderr(() =>
			emitNextSteps(
				[
					{ command: "sunat-cli login", description: "sign in" },
					{ command: "sunat-cli whoami", description: "check auth", optional: true },
				],
				"table",
			),
		);
		expect(out).toContain("Next steps:");
		expect(out).toContain("→ sunat-cli login");
		expect(out).toContain("○ sunat-cli whoami");
	});

	test("every emitted command names the installed bin, not a bare 'sunat'", () => {
		setColorOverride(false);
		const out = captureStderr(() =>
			emitNextSteps([{ command: "sunat-cli renta status", description: "service health" }], "table"),
		);
		expect(out).toMatch(/sunat-cli renta status/);
		expect(out).not.toMatch(/(^|[^-\w])sunat renta/);
	});
});
