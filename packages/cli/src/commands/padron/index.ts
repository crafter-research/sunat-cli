import { Command } from "commander";
import { isStale, loadMeta, lookupRuc, lookupRucBatch, syncPadron } from "../../sunat-rest/padron-local.ts";
import { audit } from "../../data/audit.ts";
import { output, outputError } from "../../utils/output.ts";

type Format = "json" | "table" | "auto";

function getFormat(cmd: Command): Format {
	let parent: Command | null = cmd;
	while (parent) {
		const opts = parent.opts();
		if (opts.output) return opts.output as Format;
		parent = parent.parent;
	}
	return "auto";
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function createPadronCommand(): Command {
	const padron = new Command("padron").description("SUNAT Padrón Reducido del RUC — local download + lookup. T0/T1.");

	padron
		.command("status")
		.description("Show local padrón cache status. T0.")
		.action((_, cmd) => {
			const format = getFormat(cmd);
			const meta = loadMeta();
			if (!meta) {
				output(format, { json: { synced: false, hint: "Run: sunat padron sync" } });
				return;
			}
			output(format, {
				json: {
					synced: true,
					stale: isStale(meta),
					lastFetchedAt: meta.lastFetchedAt,
					zipSize: meta.zipSize,
					zipSizeHuman: fmtBytes(meta.zipSize),
					entries: meta.entries,
					sha256: `${meta.zipSha256.slice(0, 16)}...`,
				},
			});
		});

	padron
		.command("sync")
		.description("Download (or refresh) the SUNAT padrón reducido del RUC. ~370MB ZIP, ~600MB TXT. T1.")
		.option("--force", "Force re-download even if cache is fresh (<24h)")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const start = Date.now();
				let lastLog = 0;
				const meta = await syncPadron({
					force: opts.force,
					onProgress: (down, total) => {
						const now = Date.now();
						if (format !== "json" && now - lastLog > 1000) {
							const pct = total > 0 ? Math.round((down / total) * 100) : 0;
							process.stderr.write(`\r  ${fmtBytes(down)}/${fmtBytes(total)} (${pct}%)`);
							lastLog = now;
						}
					},
				});
				if (format !== "json") process.stderr.write("\n");
				audit({
					command: "padron sync",
					args: { force: !!opts.force },
					result: "success",
					details: { zipSize: meta.zipSize, entries: meta.entries, durationMs: Date.now() - start },
				});
				output(format, {
					json: {
						synced: true,
						durationMs: Date.now() - start,
						zipSize: meta.zipSize,
						zipSizeHuman: fmtBytes(meta.zipSize),
						entries: meta.entries,
						lastFetchedAt: meta.lastFetchedAt,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	padron
		.command("ruc")
		.description("Lookup a single RUC in the local padrón. Streaming scan — slow first call (~5-15s on 600MB), instant after. T0.")
		.argument("<ruc>", "11-digit RUC to lookup")
		.action(async (ruc, opts, cmd) => {
			const format = getFormat(cmd);
			try {
				if (!/^\d{11}$/.test(ruc)) {
					outputError(`Invalid RUC: '${ruc}'. Must be 11 digits.`, format);
					return;
				}
				const entry = await lookupRuc(ruc);
				if (!entry) {
					output(format, { json: { ruc, found: false } });
					return;
				}
				output(format, { json: { ruc, found: true, ...entry } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	padron
		.command("batch")
		.description("Lookup many RUCs in one scan. Reads RUCs from stdin (one per line) or --file CSV. T0.")
		.option("--file <path>", "Path to file with one RUC per line (or CSV with RUC in first column)")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				let input = "";
				if (opts.file) {
					const { readFileSync } = await import("fs");
					input = readFileSync(opts.file, "utf-8");
				} else if (!process.stdin.isTTY) {
					input = await new Response(process.stdin as unknown as ReadableStream).text();
				} else {
					outputError("Provide --file <path> or pipe RUCs via stdin (one per line).", format);
					return;
				}

				const rucs = input
					.split("\n")
					.map((l) => l.trim().split(/[,;\t]/)[0].trim())
					.filter((l) => /^\d{11}$/.test(l));

				if (rucs.length === 0) {
					outputError("No valid 11-digit RUCs found in input.", format);
					return;
				}

				const results = await lookupRucBatch(rucs);
				const arr = Array.from(results.entries()).map(([ruc, entry]) => ({
					ruc,
					found: entry !== null,
					...(entry || {}),
				}));
				output(format, { json: arr });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return padron;
}
