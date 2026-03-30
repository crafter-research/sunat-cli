import { Command } from "commander";
import { ensureNuevaPlataformaAndF616, declareF616, navigateToF616, type F616Input } from "../../workflows/f616.ts";
import { validatePeriodo } from "../../validation/input.ts";
import { expandPeriodoRange } from "../../utils/dates.ts";
import { output, outputError } from "../../utils/output.ts";
import { audit, auditScreenshotPath } from "../../data/audit.ts";

export function createF616Command(): Command {
	const f616 = new Command("f616").description("Formulario Virtual 616 monthly declaration");

	f616
		.command("declare")
		.description("File F616 monthly tax declaration")
		.option("--json <payload>", "JSON payload with F616 data")
		.option("--batch", "Process multiple months")
		.option("--months <range>", "Month range (e.g. 2025-03..2026-02)")
		.option("--dry-run", "Preview without submitting")
		.action(async (opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			const dryRun = opts.dryRun || false;

			try {
				if (opts.batch && opts.months) {
					const periodos = expandPeriodoRange(opts.months);

					if (dryRun) {
						for (const p of periodos) {
							output(format, { json: { dryRun: true, periodo: p, status: "would-declare" } });
						}
						return;
					}

					await ensureNuevaPlataformaAndF616();
					for (const p of periodos) {
						const input: F616Input = { periodo: p, telefono: "963422021", profesion: "INGENIERO" };
						const result = await declareF616(input, auditScreenshotPath("f616"));
						audit({ command: "f616 declare", args: { periodo: p }, result: "success", details: result });
						output(format, { json: { success: true, ...result } });
						await navigateToF616();
						await new Promise((r) => setTimeout(r, 2000));
					}
				} else if (opts.json) {
					const raw = JSON.parse(opts.json);
					const periodo = validatePeriodo(String(raw.periodo));
					const input: F616Input = {
						periodo,
						telefono: raw.telefono || "963422021",
						profesion: raw.profesion || "INGENIERO",
					};

					if (dryRun) {
						audit({ command: "f616 declare", args: input, result: "dry-run" });
						output(format, { json: { dryRun: true, ...input, status: "would-declare" } });
						return;
					}

					await ensureNuevaPlataformaAndF616();
					const result = await declareF616(input, auditScreenshotPath("f616"));
					audit({ command: "f616 declare", args: input, result: "success", details: result });
					output(format, { json: { success: true, ...result } });
				} else {
					outputError("Provide --json or --batch --months. Use 'sunat-cli schema f616' to see fields.", format);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({ command: "f616 declare", args: {}, result: "error", details: { error: msg } });
				outputError(msg, format);
			}
		});

	f616
		.command("status")
		.description("Check F616 declaration status")
		.action((_, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			outputError("F616 status not implemented yet.", format);
		});

	return f616;
}
