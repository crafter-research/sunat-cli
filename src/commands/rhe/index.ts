import { Command } from "commander";
import { getCredentials } from "../../data/config.ts";
import { ensureSOLSession } from "../../browser/auth.ts";
import { emitRHE, type RHEInput } from "../../workflows/rhe.ts";
import { validateEmpresa, validateMonto, validateMoneda, validateMedioPago, validateTipoDoc } from "../../validation/input.ts";
import { output, outputError, outputSuccess } from "../../utils/output.ts";
import { audit, auditScreenshotPath } from "../../data/audit.ts";
import { readFileSync } from "fs";
import { sanitizePath } from "../../validation/input.ts";

export function createRheCommand(): Command {
	const rhe = new Command("rhe").description("Recibo por Honorarios Electronico operations");

	rhe
		.command("emit")
		.description("Emit an RHE via SUNAT SOL")
		.option("--json <payload>", "JSON payload with RHE data")
		.option("--batch <file>", "CSV file with multiple RHEs")
		.option("--dry-run", "Preview without submitting")
		.action(async (opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			const dryRun = opts.dryRun || false;

			try {
				if (opts.batch) {
					const filePath = sanitizePath(opts.batch);
					const csv = readFileSync(filePath, "utf-8");
					const rows = parseCSV(csv);
					const creds = getCredentials();

					if (!dryRun) await ensureSOLSession(creds);

					for (const row of rows) {
						const input = validateRHEInput(row);
						if (dryRun) {
							output(format, { json: { dryRun: true, input, status: "would-emit" } });
						} else {
							const result = await emitRHE(input, auditScreenshotPath("rhe-emit"));
							audit({ command: "rhe emit", args: input as unknown as Record<string, unknown>, result: "success", details: result });
							output(format, { json: { success: true, ...result } });
						}
					}
				} else if (opts.json) {
					const raw = JSON.parse(opts.json);
					const input = validateRHEInput(raw);

					if (dryRun) {
						audit({ command: "rhe emit", args: input as unknown as Record<string, unknown>, result: "dry-run" });
						output(format, { json: { dryRun: true, input, status: "would-emit" } });
					} else {
						const creds = getCredentials();
						await ensureSOLSession(creds);
						const result = await emitRHE(input, auditScreenshotPath("rhe-emit"));
						audit({ command: "rhe emit", args: input as unknown as Record<string, unknown>, result: "success", details: result });
						output(format, { json: { success: true, ...result } });
					}
				} else {
					outputError("Provide --json or --batch. Use 'sunat schema rhe' to see fields.", format);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({ command: "rhe emit", args: {}, result: "error", details: { error: msg } });
				outputError(msg, format);
			}
		});

	rhe
		.command("list")
		.description("List issued RHEs")
		.action((_, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			outputError("Not implemented yet. Use SOL portal directly.", format);
		});

	rhe
		.command("verify")
		.description("Verify RHE registration via SUNAT API")
		.option("--month <periodo>", "Month to verify (YYYY-MM)")
		.action((_, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			outputError("Not implemented yet. Will use OAuth2 API.", format);
		});

	return rhe;
}

function validateRHEInput(raw: Record<string, unknown>): RHEInput {
	return {
		empresa: validateEmpresa(String(raw.empresa || "")),
		tipoDoc: validateTipoDoc(String(raw.tipoDoc || "SIN DOCUMENTO")),
		descripcion: String(raw.descripcion || ""),
		monto: validateMonto(Number(raw.monto || raw.monto_pen || 0)),
		moneda: validateMoneda(String(raw.moneda || "PEN")),
		medioPago: validateMedioPago(String(raw.medioPago || "TRANSFERENCIA")),
		fechaEmision: String(raw.fechaEmision || ""),
	};
}

function parseCSV(csv: string): Record<string, string>[] {
	const lines = csv.trim().split("\n");
	const headers = lines[0].split(",").map((h) => h.trim());
	return lines.slice(1).map((line) => {
		const values = line.split(",").map((v) => v.trim());
		const obj: Record<string, string> = {};
		headers.forEach((h, i) => (obj[h] = values[i] || ""));
		return obj;
	});
}
