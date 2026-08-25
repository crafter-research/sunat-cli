import { bold, danger, dim, muted, padStartVisible, padVisible, visibleWidth } from "./style.ts";

export type OutputFormat = "json" | "table" | "auto";

export function outputJSON(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

export function outputNDJSON(items: unknown[]): void {
	for (const item of items) {
		console.log(JSON.stringify(item));
	}
}

/** Right-align a column when every one of its cells reads as a number. */
function isNumericColumn(rows: string[][], i: number): boolean {
	const cells = rows.map((r) => (r[i] ?? "").trim()).filter(Boolean);
	if (cells.length === 0) return false;
	return cells.every((c) => /^-?[\d.,]+%?$/.test(c));
}

/**
 * Column widths are measured with `visibleWidth`, not `.length`: a styled cell
 * carries escape sequences that occupy no columns on screen, so `.length`
 * over-pads by exactly the size of the escapes and the grid drifts.
 */
export function outputTable(headers: string[], rows: string[][]): void {
	const widths = headers.map((h, i) => Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i] || ""))));
	const numeric = headers.map((_, i) => isNumericColumn(rows, i));
	const pad = (cell: string, i: number) =>
		numeric[i] ? padStartVisible(cell, widths[i]) : padVisible(cell, widths[i]);

	console.log(headers.map((h, i) => pad(bold(h), i)).join(muted("  ")));
	console.log(muted(widths.map((w) => "─".repeat(w)).join("  ")));
	for (const row of rows) {
		console.log(row.map((cell, i) => pad(cell || "", i)).join("  "));
	}
}

/**
 * The one place that decides machine versus human output.
 *
 * `auto` resolves from the TTY, so a piped or captured run is machine-readable
 * without the caller passing a flag. Every site that needs the answer imports
 * this rather than reading `isTTY` again: three copies of the rule had drifted
 * apart, and the command that forgets is the one an agent hits.
 *
 * A TTY check guarding a prompt is a different question and does not belong
 * here.
 */
export function resolveFormat(format: OutputFormat): "json" | "table" {
	if (format === "auto") return process.stdout.isTTY ? "table" : "json";
	return format;
}

export function isHumanFormat(format: OutputFormat): boolean {
	return resolveFormat(format) === "table";
}

export function output(
	format: OutputFormat,
	data: { json: unknown; table?: { headers: string[]; rows: string[][] } },
): void {
	const resolvedFormat = resolveFormat(format);

	if (resolvedFormat === "json") {
		if (Array.isArray(data.json)) {
			outputNDJSON(data.json);
		} else {
			outputJSON(data.json);
		}
	} else if (data.table) {
		outputTable(data.table.headers, data.table.rows);
	} else {
		outputJSON(data.json);
	}
}

export function outputSuccess(message: string, format: OutputFormat): void {
	if (format === "json") {
		outputJSON({ success: true, message });
	} else {
		console.log(`${bold("✓")} ${message}`);
	}
}

/**
 * Errors go to stderr in both modes.
 *
 * Data on stdout, diagnostics on stderr: a caller doing `cmd > out.json` must
 * not find an error envelope in the file it is about to parse as a result.
 *
 * The human form reads as three levels: the word in `danger`, a searchable code
 * beside it, the message plain, and the hint on its own line, because the hint
 * is the way out rather than the problem.
 */
export function outputError(error: string, format: OutputFormat, opts?: { code?: string; hint?: string }): void {
	if (format === "json") {
		console.error(JSON.stringify({ success: false, error, ...(opts?.code ? { code: opts.code } : {}) }, null, 2));
	} else {
		const code = opts?.code ? ` ${muted(opts.code)}` : "";
		console.error(`${danger("Error")}${code}  ${error}`);
		if (opts?.hint) console.error(dim(`  ${opts.hint}`));
	}
	process.exit(1);
}
