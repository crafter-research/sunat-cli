import type { ThemeRegistration } from "shiki";

/**
 * Two themes sharing one structure, differing only in palette.
 *
 * The scopes below are the ones the bash grammar actually emits, read off
 * `codeToTokens(..., { includeExplanation: true })` rather than guessed:
 * a shell argument is `string.unquoted.argument.shell`, a flag is
 * `constant.other.option.dash.shell`, and the leading `$` of a line is
 * `entity.name.command.shell`. Targeting the generic `keyword` scope, which a
 * TextMate theme normally leans on, colours nothing in a shell transcript.
 */

type Slot =
	| "bg"
	| "fg"
	| "comment"
	| "prompt"
	| "command"
	| "flag"
	| "value"
	| "num"
	| "punct";

const LIGHT: Record<Slot, string> = {
	bg: "#EDECE6",
	fg: "#494F53",
	comment: "#64696C",
	prompt: "#656A6D",
	command: "#17191A",
	flag: "#8F5A02",
	value: "#15633E",
	num: "#8E2F39",
	punct: "#6E7376",
};

const DARK: Record<Slot, string> = {
	bg: "#111517",
	fg: "#A6ADB0",
	comment: "#7D8488",
	prompt: "#828A8E",
	command: "#EDEDEC",
	flag: "#FFB020",
	value: "#7FD1A4",
	num: "#FF9FA4",
	punct: "#8B9296",
};

function build(
	name: string,
	type: "light" | "dark",
	p: Record<Slot, string>,
): ThemeRegistration {
	return {
		name,
		type,
		fg: p.fg,
		bg: p.bg,
		settings: [
			{ settings: { foreground: p.fg, background: p.bg } },
			{
				scope: [
					"comment",
					"comment.line",
					"comment.line.number-sign.shell",
					"punctuation.definition.comment",
					"punctuation.definition.comment.shell",
				],
				settings: { foreground: p.comment, fontStyle: "italic" },
			},
			{
				// The `$` that opens a transcript line, and any bare command name.
				scope: [
					"entity.name.command",
					"entity.name.command.shell",
					"entity.name.function.call.shell",
					"support.function",
				],
				settings: { foreground: p.prompt },
			},
			{
				// Subcommands and operands: `cpe factura emit`, `@factura.json`.
				scope: [
					"string.unquoted.argument",
					"string.unquoted.argument.shell",
					"meta.argument.shell",
				],
				settings: { foreground: p.command },
			},
			{
				scope: [
					"constant.other.option",
					"constant.other.option.dash.shell",
					"keyword",
					"keyword.operator",
					"keyword.control",
				],
				settings: { foreground: p.flag },
			},
			{
				scope: [
					"string.quoted",
					"string.quoted.double",
					"string.quoted.single",
					"string.quoted.double.shell",
					"string.quoted.single.shell",
				],
				settings: { foreground: p.value },
			},
			{
				scope: [
					"constant.numeric",
					"constant.numeric.shell",
					"constant.numeric.octal.shell",
					"constant.language",
				],
				settings: { foreground: p.num },
			},
			{
				scope: [
					"punctuation",
					"meta.brace",
					"punctuation.definition.string",
					"punctuation.separator",
				],
				settings: { foreground: p.punct },
			},
			{
				scope: ["variable", "variable.other", "variable.parameter"],
				settings: { foreground: p.fg },
			},
		],
		colors: {
			"editor.background": p.bg,
			"editor.foreground": p.fg,
		},
	};
}

export const sunatLight = build("sunat-light", "light", LIGHT);
export const sunatDark = build("sunat-dark", "dark", DARK);

export const dualThemes = { light: sunatLight, dark: sunatDark } as const;
