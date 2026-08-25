/**
 * The ASCII wordmark shown on bare invoke and `--help`.
 *
 * Three constraints decide everything here:
 *
 * 1. STDERR ONLY. stdout is data territory. A banner on stdout ends up inside
 *    `sunat-cli ... > out.json` and breaks the parse, which is the whole reason
 *    a machine-readable CLI keeps the streams apart.
 * 2. TTY ONLY. Piped output, machine mode, and CI get nothing at all.
 * 3. NO_COLOR removes the drawing, not just the colour. The wordmark IS the
 *    colour: rendered as plain blocks it is a wall of glyphs a screen reader
 *    reads one by one. Under NO_COLOR it degrades to a single plain line, which
 *    is the same information without the ink.
 *
 * Pattern taken from cligentic's `foundation/banner`, reimplemented against
 * this repo's own `style.ts` rather than installed: a published output contract
 * outranks a shared block.
 */

import { shouldColor } from "./style.ts";

/**
 * The wordmark, on the 5-line grid cligentic's GLYPHS use.
 *
 * "-" has no glyph in that font. It was added by hand on the same grid: a
 * single bar on the middle row, one cell narrower than a letter so the two
 * words stay visually separate.
 */
const WORDMARK: readonly string[] = [
	" ████ █   █ █   █   █   █████        ████ █     █████",
	"█     █   █ ██  █  █ █    █         █     █       █  ",
	" ███  █   █ █ █ █ █████   █   ████  █     █       █  ",
	"    █ █   █ █  ██ █   █   █         █     █       █  ",
	"████   ███  █   █ █   █   █          ████ █████ █████",
];

/** SUNAT's institutional red, faded down the block. */
const GRADIENT: readonly [string, string] = ["#D8232A", "#7A1418"];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace("#", "");
	return {
		r: Number.parseInt(h.slice(0, 2), 16),
		g: Number.parseInt(h.slice(2, 4), 16),
		b: Number.parseInt(h.slice(4, 6), 16),
	};
}

export type BannerOptions = {
	version: string;
	tagline?: string;
};

/**
 * Build the banner as lines. Separated from the writing so a test can assert
 * the content without a terminal, and so the caller cannot accidentally send it
 * to the wrong stream.
 */
export function buildBanner(opts: BannerOptions, color: boolean): string[] {
	const meta = [`v${opts.version}`, opts.tagline].filter(Boolean).join("  ·  ");

	if (!color) return ["", `  sunat-cli ${meta}`, ""];

	const from = hexToRgb(GRADIENT[0]);
	const to = hexToRgb(GRADIENT[1]);
	const lines = WORDMARK.map((line, i) => {
		const t = WORDMARK.length > 1 ? i / (WORDMARK.length - 1) : 0;
		const r = Math.round(from.r + (to.r - from.r) * t);
		const g = Math.round(from.g + (to.g - from.g) * t);
		const b = Math.round(from.b + (to.b - from.b) * t);
		return `  \x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
	});

	return ["", ...lines, `  \x1b[2m${meta}\x1b[0m`, ""];
}

/**
 * Write the banner to stderr when a person is watching, and never otherwise.
 *
 * `process.stderr.isTTY` is the gate rather than stdout's: the banner is only
 * legible if the stream it lands on is a terminal, and a caller redirecting
 * stdout to a file still deserves to see it.
 */
export function printBanner(opts: BannerOptions): void {
	if (!process.stderr.isTTY) return;
	for (const line of buildBanner(opts, shouldColor())) {
		process.stderr.write(`${line}\n`);
	}
}
