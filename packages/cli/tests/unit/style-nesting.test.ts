import { describe, expect, test } from "bun:test";
import { bold, dim, setColorOverride, stripAnsi, visibleWidth } from "../../src/utils/style.ts";

describe("nested bold and dim", () => {
	test("a bold span inside a dim one does not end the dim", () => {
		setColorOverride(true);
		try {
			const out = dim(`before ${bold("BOLD")} after`);
			expect(out).toContain("\x1b[22m\x1b[2m");
			expect(out.endsWith("\x1b[22m")).toBe(true);
		} finally {
			setColorOverride(null);
		}
	});

	test("nesting changes bytes but not the text or its width", () => {
		setColorOverride(true);
		try {
			const out = dim(`before ${bold("BOLD")} after`);
			expect(stripAnsi(out)).toBe("before BOLD after");
			expect(visibleWidth(out)).toBe(17);
		} finally {
			setColorOverride(null);
		}
	});

	test("styling is absent when color is off", () => {
		setColorOverride(false);
		try {
			expect(dim(`before ${bold("BOLD")} after`)).toBe("before BOLD after");
		} finally {
			setColorOverride(null);
		}
	});
});
