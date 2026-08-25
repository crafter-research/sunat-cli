import { describe, expect, test } from "bun:test";
import { buildBanner } from "../../src/utils/banner.ts";
import { stripAnsi } from "../../src/utils/style.ts";

const OPTS = { version: "0.9.0", tagline: "Agent-first CLI for SUNAT tax automation" };

describe("buildBanner", () => {
	test("draws the wordmark on a uniform grid", () => {
		const glyphs = buildBanner(OPTS, true)
			.filter((l) => l.includes("█"))
			.map((l) => [...stripAnsi(l).slice(2)].length);

		expect(glyphs).toHaveLength(5);
		expect(new Set(glyphs).size).toBe(1);
	});

	test("keeps the hyphen on the middle row only, since the font has no glyph for it", () => {
		const rows = buildBanner(OPTS, true)
			.filter((l) => l.includes("█"))
			.map((l) => [...stripAnsi(l).slice(2)]);

		const width = rows[0]?.length ?? 0;
		const middleOnly: number[] = [];
		for (let c = 0; c < width; c++) {
			const ink = rows.map((r) => r[c] === "█");
			if (ink[2] && !ink[0] && !ink[1] && !ink[3] && !ink[4]) middleOnly.push(c);
		}

		expect(middleOnly).toEqual([14, 30, 31, 32, 33]);
	});

	test("carries the version and tagline", () => {
		const text = stripAnsi(buildBanner(OPTS, true).join("\n"));
		expect(text).toContain("v0.9.0");
		expect(text).toContain("Agent-first CLI for SUNAT tax automation");
	});

	test("degrades to a single plain line without colour", () => {
		const lines = buildBanner(OPTS, false);
		const text = lines.join("\n");

		expect(text).toBe(stripAnsi(text));
		expect(text).not.toContain("█");
		expect(text).toContain("sunat-cli v0.9.0");
	});

	test("emits colour only when asked", () => {
		const colored = buildBanner(OPTS, true).join("\n");
		expect(colored).not.toBe(stripAnsi(colored));
	});
});
