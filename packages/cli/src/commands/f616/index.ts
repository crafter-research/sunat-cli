import { Command } from "commander";
import { audit } from "../../data/audit.ts";
import { ensurePlataformaToken } from "../../plataforma/ensure-token.ts";
import { obtenerListaOficios, obtenerPeriodo } from "../../plataforma/f616-api.ts";
import { expandPeriodoRange } from "../../utils/dates.ts";
import { resolveParams } from "../../utils/deprecation.ts";
import { output, outputError } from "../../utils/output.ts";
import { validatePeriodo } from "../../validation/input.ts";
import { declareF616, ensureNuevaPlataformaAndF616, type F616Input, navigateToF616 } from "../../workflows/f616.ts";
import { createDeclararCommand } from "./declarar.ts";

export function createF616Command(): Command {
	const f616 = new Command("f616").description("Formulario Virtual 616 monthly declaration");

	f616
		.command("declare")
		.description("File F616 monthly tax declaration")
		.option("--params <json>", "JSON payload (see: sunat-cli schema f616)")
		.option("--json <payload>", "Deprecated alias for --params, will be removed in a later 0.x release")
		.option("--batch", "Process multiple months")
		.option("--months <range>", "Month range (e.g. 2025-03..2026-02)")
		.option("--dry-run", "Preview without submitting")
		.option("--telefono <n>", "Phone required by SUNAT's Información General")
		.option("--profesion <p>", "Profession from SUNAT's catalog")
		.action(async (opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			const dryRun = opts.dryRun || false;
			const params = resolveParams(opts, "--params", "--json", format);

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
						if (!opts.telefono || !opts.profesion)
							throw new Error("--telefono and --profesion are required for batch declarations.");
						const input: F616Input = { periodo: p, telefono: opts.telefono, profesion: opts.profesion };
						const result = await declareF616(input);
						audit({ command: "f616 declare", args: { periodo: p }, result: "success", details: { ...result } });
						output(format, { json: { success: true, ...result } });
						await navigateToF616();
						await new Promise((r) => setTimeout(r, 2000));
					}
				} else if (params) {
					const raw = JSON.parse(params);
					const periodo = validatePeriodo(String(raw.periodo));
					const input: F616Input = {
						periodo,
						telefono: raw.telefono,
						profesion: raw.profesion,
					};
					if (!input.telefono || !input.profesion)
						throw new Error("telefono and profesion are required in the F616 payload.");

					if (dryRun) {
						audit({ command: "f616 declare", args: { ...input }, result: "dry-run" });
						output(format, { json: { dryRun: true, ...input, status: "would-declare" } });
						return;
					}

					await ensureNuevaPlataformaAndF616();
					const result = await declareF616(input);
					audit({ command: "f616 declare", args: { ...input }, result: "success", details: { ...result } });
					output(format, { json: { success: true, ...result } });
				} else {
					outputError("Provide --params or --batch --months. Use 'sunat-cli schema f616' to see fields.", format);
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

	f616
		.command("periodo")
		.description(
			"Open an F616 period through the API (read-only, T0). Reuses a cached Nueva Plataforma token, opening the browser only to capture one when needed.",
		)
		.argument("<periodo>", "Tax period (YYYY-MM)")
		.action(async (periodo, _opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			try {
				validatePeriodo(periodo);
				await ensurePlataformaToken();
				const data = (await obtenerPeriodo(periodo)) as { resultado?: Record<string, unknown> };
				const r = data.resultado ?? {};
				output(format, {
					json: { periodo, ...r },
					table: {
						headers: ["Campo", "Valor"],
						rows: [
							["fecha", String(r.fec_hoy ?? "")],
							["tipos de comprobante", String((r.tip_compr_list as unknown[] | undefined)?.length ?? 0)],
						],
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	f616
		.command("oficios")
		.description("List the SUNAT profession catalog (Catálogo de oficios) through the API. T0.")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			try {
				await ensurePlataformaToken();
				const data = (await obtenerListaOficios()) as { resultado?: Array<Record<string, string>> };
				const rows = (data.resultado ?? []).map((o) => [o.tip_prof, o.des_tip_prof]);
				output(format, {
					json: { count: rows.length, oficios: data.resultado ?? [] },
					table: { headers: ["Código", "Profesión"], rows },
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	f616.addCommand(createDeclararCommand());

	return f616;
}
