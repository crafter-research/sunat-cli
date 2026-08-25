/**
 * Terminal styling for the human-facing branch.
 *
 * Three decisions worth knowing, because they are the ones that get written
 * wrong from memory:
 *
 * 1. ONE place consults `shouldColor()`. Styling applied per call site is
 *    styling that leaks into a piped stream the first time someone forgets.
 * 2. 256-color, not the basic 8. Basic red/green render as whatever the user's
 *    theme assigns, which on a light terminal can be unreadable.
 * 3. Semantic names over color names, so a call site reads as intent and the
 *    palette can change without touching it.
 *
 * Width matters as much as color: `"\x1b[1mHi\x1b[0m".length` is 12 while its
 * width on screen is 2, so any column alignment using `.length` on styled text
 * is off by the size of the escapes.
 */

let forced: boolean | null = null;

/** Test seam: force colour on or off regardless of TTY. */
export function setColorOverride(on: boolean | null): void {
	forced = on;
}

export function shouldColor(): boolean {
	if (forced !== null) return forced;
	if (process.env.NO_COLOR) return false;
	if (process.env.FORCE_COLOR) return true;
	return Boolean(process.stdout.isTTY);
}

const wrap = (open: string, close: string) => (s: string) => (shouldColor() ? `${open}${s}${close}` : s);

/**
 * Bold and dim share a reset. SGR 22 turns off both, so a bold span nested
 * inside a dim one ends the dim early and the rest of the line silently loses
 * its styling. Reopening the outer attribute after each inner reset costs a few
 * bytes and makes nesting behave the way a caller expects.
 *
 * `visibleWidth` strips these the same either way, so column arithmetic is
 * unaffected.
 */
const wrapShared =
	(open: string, close: string) =>
	(s: string): string => {
		if (!shouldColor()) return s;
		return `${open}${s.replaceAll(close, `${close}${open}`)}${close}`;
	};

export const bold = wrapShared("\x1b[1m", "\x1b[22m");
export const dim = wrapShared("\x1b[2m", "\x1b[22m");
export const italic = wrap("\x1b[3m", "\x1b[23m");
export const underline = wrap("\x1b[4m", "\x1b[24m");

const fg = (n: number) => wrap(`\x1b[38;5;${n}m`, "\x1b[39m");

/**
 * Semantic palette. `danger` is reserved for errors and nothing else: once red
 * means anything else it stops meaning error, and error is the one state a
 * reader must not have to parse.
 */
export const danger = fg(203);
export const warn = fg(214);
export const ok = fg(78);
export const info = fg(75);
export const muted = fg(245);

// biome-ignore lint/suspicious/noControlCharactersInRegex: measuring around terminal escapes is the point
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
	return s.replace(ANSI, "");
}

/** Visible width, i.e. what the terminal draws, ignoring escape sequences. */
export function visibleWidth(s: string): number {
	return stripAnsi(s).length;
}

export function padVisible(s: string, width: number): string {
	const pad = width - visibleWidth(s);
	return pad > 0 ? s + " ".repeat(pad) : s;
}

export function padStartVisible(s: string, width: number): string {
	const pad = width - visibleWidth(s);
	return pad > 0 ? " ".repeat(pad) + s : s;
}

/**
 * A preview of a secret that identifies it without disclosing it.
 *
 * Keeps the head and tail so a reader can tell two credentials apart, and
 * spends a fixed-width ellipsis on the middle so the output never leaks the
 * length of what it hides. Anything too short to mask safely renders fully
 * masked rather than partially revealed.
 */
export function maskSecret(secret: string, visible = 4): string {
	if (secret.length <= visible * 2) return "•".repeat(8);
	return `${secret.slice(0, visible)}…${secret.slice(-visible)}`;
}

export function truncateVisible(s: string, width: number): string {
	if (visibleWidth(s) <= width) return s;
	if (width <= 1) return stripAnsi(s).slice(0, width);
	return `${stripAnsi(s).slice(0, width - 1)}…`;
}
