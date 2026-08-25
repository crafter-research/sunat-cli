import { Command } from "commander";
import { audit } from "../../data/audit.ts";
import type { PadronEntry } from "../../sunat-rest/padron-local.ts";
import { isStale, loadMeta, lookupRuc, lookupRucBatch, syncPadron } from "../../sunat-rest/padron-local.ts";
import { emitNextSteps } from "../../utils/next-steps.ts";
import { isHumanFormat, output, outputError } from "../../utils/output.ts";
import { bold, dim, muted, ok, warn } from "../../utils/style.ts";

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

/**
 * True when the human branch should render. The root normalizes `auto` to
 * `table` or `json` before an action runs, so `auto` only survives here when a
 * subcommand is invoked outside that hook.
 */
function isHuman(format: Format): boolean {
	return isHumanFormat(format);
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Age a reader does not have to compute. An ISO timestamp states a fact; the
 * question behind `padron status` is how out of date the cache is right now.
 */
export function fmtAge(iso: string, now: number = Date.now()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "unknown";
	const mins = Math.floor((now - then) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 60) return `${days} days ago`;
	return `${days} days ago (${Math.floor(days / 30)} months)`;
}

/**
 * SUNAT writes the padrón's own placeholder as a literal "-", so a dash means
 * absent rather than short. Measured on the local padrón: 1,999,990 of
 * 2,000,000 address cells across 200k rows are this sentinel.
 */
function present(v: string | undefined): string | undefined {
	if (v === undefined) return undefined;
	const t = v.trim();
	return t === "" || t === "-" ? undefined : t;
}

/**
 * `danger` stays reserved for errors. A taxpayer given de baja is a state, not
 * a failure of the command, so closed states read `muted` and only the
 * attention-worthy one takes `warn`.
 */
export function styleEstado(estado: string): string {
	const v = estado.toUpperCase();
	if (v === "ACTIVO") return ok(estado);
	if (v.startsWith("SUSPENSION")) return warn(estado);
	return muted(estado);
}

/** HABIDO is the clean state; every NO HABIDO / NO HALLADO variant wants attention. */
export function styleCondicion(condicion: string): string {
	const v = condicion.toUpperCase();
	if (v === "HABIDO") return ok(condicion);
	if (v.startsWith("NO HABIDO") || v.startsWith("NO HALLADO")) return warn(condicion);
	return muted(condicion);
}

/**
 * Join the address components the padrón reducido actually carries. Returns
 * undefined when every component is the "-" sentinel, which is the common case:
 * ten rows each reading "-" is vertical repetition, so the block is dropped
 * rather than printed empty.
 */
export function fmtDireccion(e: PadronEntry): string | undefined {
	const via = [present(e.tipoVia), present(e.nombreVia)].filter(Boolean).join(" ");
	const zona =
		present(e.tipoZona) && present(e.codigoZona)
			? `${present(e.tipoZona)} ${present(e.codigoZona)}`
			: present(e.tipoZona) || present(e.codigoZona);
	const parts = [
		via || undefined,
		present(e.numero) && `Nro. ${present(e.numero)}`,
		present(e.interior) && `Int. ${present(e.interior)}`,
		present(e.manzana) && `Mz. ${present(e.manzana)}`,
		present(e.lote) && `Lt. ${present(e.lote)}`,
		present(e.kilometro) && `Km. ${present(e.kilometro)}`,
		zona,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : undefined;
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
				if (isHuman(format)) {
					console.log(`${warn("○")} Padrón not synced`);
					console.log(dim("  Run: sunat-cli padron sync"));
					return;
				}
				output(format, { json: { synced: false, hint: "Run: sunat-cli padron sync" } });
				emitNextSteps(
					[{ command: "sunat-cli padron sync", description: "download the padrón for the first time" }],
					format,
				);
				return;
			}

			const stale = isStale(meta);
			if (isHuman(format)) {
				// The reader's question is "can I trust a lookup right now", not the meta object.
				console.log(
					stale
						? `${warn("●")} Padrón usable but ${bold("stale")}  ${muted(`updated ${fmtAge(meta.lastFetchedAt)}`)}`
						: `${ok("●")} Padrón up to date  ${muted(`updated ${fmtAge(meta.lastFetchedAt)}`)}`,
				);
				// `entries` is estimated from byte size / avg row upstream, so it reads as approximate.
				const count = meta.entries === undefined ? "?" : `~${meta.entries.toLocaleString("en-US")}`;
				console.log(dim(`  ${count} RUCs · ${fmtBytes(meta.zipSize)} · SUNAT republishes daily`));
				if (stale) console.log(dim("  Refresh: sunat-cli padron sync"));
				return;
			}

			output(format, {
				json: {
					synced: true,
					stale,
					lastFetchedAt: meta.lastFetchedAt,
					zipSize: meta.zipSize,
					zipSizeHuman: fmtBytes(meta.zipSize),
					entries: meta.entries,
					sha256: `${meta.zipSha256.slice(0, 16)}...`,
				},
			});
			emitNextSteps(
				stale ? [{ command: "sunat-cli padron sync", description: "the local copy is out of date" }] : [],
				format,
			);
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
		.description(
			"Lookup a single RUC in the local padrón. Streaming scan — slow first call (~5-15s on 600MB), instant after. T0.",
		)
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
					if (isHuman(format)) {
						console.log(`${warn("○")} RUC ${bold(ruc)} not found in the local padrón`);
						const meta = loadMeta();
						console.log(
							dim(
								isStale(meta)
									? `  Cache updated ${fmtAge(meta?.lastFetchedAt ?? "")}. Refresh: sunat-cli padron sync`
									: `  Check the digits, or query SUNAT directly: sunat-cli padron ruc-online ${ruc}`,
							),
						);
						return;
					}
					output(format, { json: { ruc, found: false } });
					return;
				}

				if (isHuman(format)) {
					console.log(bold(entry.razonSocial));
					console.log(`${muted("RUC")} ${entry.ruc}`);
					console.log();
					console.log(`  ${dim("Estado".padEnd(9))}  ${styleEstado(entry.estado)}`);
					console.log(`  ${dim("Condición".padEnd(9))}  ${styleCondicion(entry.condicion)}`);
					// Ten rows each reading "-" is repetition, not data: print only what exists.
					const direccion = fmtDireccion(entry);
					const ubigeo = present(entry.ubigeo);
					if (direccion) console.log(`  ${dim("Dirección".padEnd(9))}  ${direccion}`);
					if (ubigeo) console.log(`  ${dim("Ubigeo".padEnd(9))}  ${ubigeo}`);
					if (!direccion && !ubigeo) {
						console.log();
						console.log(muted("  The padrón reducido carries no address for this RUC."));
					}
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
					.map((l) =>
						l
							.trim()
							.split(/[,;\t]/)[0]
							.trim(),
					)
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

	padron
		.command("ruc-online")
		.description(
			"Lookup a single RUC by driving the SUNAT portal via agent-browser " +
				"(slow ~5-10s, no padrón sync needed). For batch use 'padron ruc/batch' instead. T0.",
		)
		.argument("<ruc>", "11-digit RUC")
		.action(async (ruc, _opts, cmd) => {
			const format = getFormat(cmd);
			try {
				if (!/^\d{11}$/.test(ruc)) {
					outputError(`Invalid RUC: '${ruc}'. Must be 11 digits.`, format);
					return;
				}
				const { consultarRucPortal } = await import("../../sunat-rest/ruc-portal.ts");
				const entry = await consultarRucPortal(ruc);
				if (!entry) {
					output(format, { json: { ruc, found: false, source: "sunat-portal" } });
					return;
				}
				output(format, { json: { found: true, ...entry } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return padron;
}
