export type OutputFormat = "json" | "table" | "auto";

export function outputJSON(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

export function outputNDJSON(items: unknown[]): void {
	for (const item of items) {
		console.log(JSON.stringify(item));
	}
}

export function outputTable(headers: string[], rows: string[][]): void {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || "").length)));
	const line = widths.map((w) => "-".repeat(w + 2)).join("+");
	const formatRow = (row: string[]) => row.map((cell, i) => ` ${(cell || "").padEnd(widths[i])} `).join("|");

	console.log(formatRow(headers));
	console.log(line);
	for (const row of rows) {
		console.log(formatRow(row));
	}
}

export function output(format: OutputFormat, data: { json: unknown; table?: { headers: string[]; rows: string[][] } }): void {
	const resolvedFormat = format === "auto" ? (process.stdout.isTTY ? "table" : "json") : format;

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
		console.log(`✓ ${message}`);
	}
}

export function outputError(error: string, format: OutputFormat): void {
	if (format === "json") {
		outputJSON({ success: false, error });
	} else {
		console.error(`✗ ${error}`);
	}
	process.exit(1);
}
