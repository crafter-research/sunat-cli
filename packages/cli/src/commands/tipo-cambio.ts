import { Command } from "commander";
import { audit } from "../data/audit.ts";
import { getTipoCambio, loadCachedTc } from "../sunat-rest/tipo-cambio.ts";
import { isHumanFormat, output, outputError } from "../utils/output.ts";
import { bold, dim, muted } from "../utils/style.ts";

/**
 * The rate is what a person came for, so it leads. Compra and venta sit
 * side by side because the gap between them is the thing a reader compares,
 * and the date is context rather than the answer.
 */
function renderRate(rate: { fecha: string; compra: number; venta: number; moneda?: string }): void {
	const moneda = rate.moneda ?? "USD";
	console.log(`${bold(`S/ ${rate.venta.toFixed(3)}`)} venta   ${bold(`S/ ${rate.compra.toFixed(3)}`)} compra`);
	console.log(dim(`  ${moneda} · ${rate.fecha} · fuente SUNAT`));
}

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

export function createTipoCambioCommand(): Command {
	const tc = new Command("tipo-cambio").description(
		"Tipo de Cambio oficial SUNAT (USD/PEN) — scrapes the SUNAT portal via agent-browser. T0.",
	);

	tc.option("--fecha <YYYY-MM-DD>", "Date for which to fetch the rate (defaults to today)")
		.option("--force", "Bypass local cache (default: cached if present, since SUNAT TC is immutable per date)")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const fecha = opts.fecha;
				if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
					outputError(`--fecha must be YYYY-MM-DD, got: ${fecha}`, format);
					return;
				}
				const rate = await getTipoCambio({ fecha, force: !!opts.force });
				audit({
					command: "tipo-cambio",
					args: { fecha: fecha || "today", force: !!opts.force },
					result: "success",
					details: { fecha: rate.fecha, compra: rate.compra, venta: rate.venta },
				});
				if (isHumanFormat(format)) {
					renderRate(rate);
					return;
				}
				output(format, { json: rate });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	tc.command("cached")
		.description("List rates already cached locally without scraping. T0.")
		.option("--fecha <YYYY-MM-DD>", "Filter to one specific date")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				// `--fecha` is declared on both this command and its parent, and
				// Commander binds it to the parent, so reading only opts.fecha
				// left it empty and the command rejected a flag the caller had
				// actually passed.
				const fecha = opts.fecha || cmd.parent?.opts().fecha;
				if (fecha) {
					const r = loadCachedTc(fecha);
					if (isHumanFormat(format)) {
						if (r) renderRate(r);
						else console.log(muted(`Sin tipo de cambio en cache para ${fecha}`));
						return;
					}
					output(format, { json: r ? { found: true, ...r } : { found: false, fecha } });
					return;
				}
				outputError("--fecha required for 'cached' (full cache list shaped, not implemented)", format);
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return tc;
}
