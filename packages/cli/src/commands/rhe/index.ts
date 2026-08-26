import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { ensureSOLSession } from "../../browser/auth.ts";
import { audit } from "../../data/audit.ts";
import { getCredentials } from "../../data/config.ts";
import { resolveParams } from "../../utils/deprecation.ts";
import { output, outputError } from "../../utils/output.ts";
import {
	rejectControlChars,
	sanitizePath,
	validateEmpresa,
	validateMedioPago,
	validateMoneda,
	validateMonto,
	validateTipoDoc,
} from "../../validation/input.ts";
import { emitRHE, type RHEInput } from "../../workflows/rhe.ts";

export function createRheCommand(): Command {
	const rhe = new Command("rhe").description("Recibo por Honorarios Electronico operations");

	rhe
		.command("emit")
		.description("Emit an RHE via SUNAT SOL")
		.option("--params <json>", "JSON payload (see: sunat-cli schema rhe)")
		.option("--json <payload>", "Deprecated alias for --params, will be removed in a later 0.x release")
		.option("--batch <file>", "CSV file with multiple RHEs")
		.option("--dry-run", "Validate locally without opening SUNAT")
		.option("--preview-only", "Fill SUNAT and stop at the reconciled preview")
		.option("--artifacts-dir <dir>", "Directory for the issued XML and PDF", join(homedir(), "Downloads", "sunat-rhe"))
		.option("--yes", "Confirm the requested live operation")
		.option("--live-sunat", "Acknowledge that this writes to production SUNAT")
		.action(async (opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			const dryRun = opts.dryRun || false;
			const previewOnly = opts.previewOnly || false;
			const params = resolveParams(opts, "--params", "--json", format);

			try {
				if (dryRun && previewOnly) throw new Error("Use either --dry-run or --preview-only, not both");
				if (opts.batch && previewOnly) throw new Error("--preview-only supports one RHE at a time, not --batch");
				if (opts.batch && !dryRun) {
					throw new Error(
						"Live RHE batch emission is disabled. Validate the batch with --dry-run, then preview and emit one RHE at a time.",
					);
				}
				if (!dryRun && !previewOnly && (!opts.yes || !opts.liveSunat)) {
					throw new Error("Live RHE emission requires both --yes and --live-sunat. Use --preview-only first.");
				}
				if (opts.batch) {
					const filePath = sanitizePath(opts.batch);
					const csv = readFileSync(filePath, "utf-8");
					const rows = parseCSV(csv);

					for (const row of rows) {
						const input = validateRHEInput(row);
						output(format, { json: { dryRun: true, input, status: "would-emit" } });
					}
				} else if (params) {
					const raw = JSON.parse(params);
					const input = validateRHEInput(raw);

					if (dryRun) {
						audit({ command: "rhe emit", args: input as unknown as Record<string, unknown>, result: "dry-run" });
						output(format, { json: { dryRun: true, input, status: "would-emit" } });
					} else {
						const artifactsDir = sanitizePath(String(opts.artifactsDir));
						const creds = getCredentials();
						await ensureSOLSession(creds);
						const result = await emitRHE(input, {
							previewOnly,
							artifactsDir: previewOnly ? undefined : artifactsDir,
							beforeSubmit: () =>
								audit({
									command: "rhe emit",
									args: input as unknown as Record<string, unknown>,
									result: "pending",
									details: { stage: "pre-submit" },
								}),
						});
						audit({
							command: "rhe emit",
							args: input as unknown as Record<string, unknown>,
							result: previewOnly ? "dry-run" : result.status === "submitted-unverified" ? "pending" : "success",
							details: previewOnly
								? { stage: "pre-submit" }
								: { status: result.status === "submitted-unverified" ? "submitted" : "completed" },
						});
						output(format, { json: { success: previewOnly || result.status === "issued", ...result } });
					}
				} else {
					outputError("Provide --params or --batch. Use 'sunat-cli schema rhe' to see fields.", format);
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
	const tipoDoc = validateTipoDoc(String(raw.tipoDoc || "SIN DOCUMENTO"));
	if (tipoDoc !== "SIN DOCUMENTO") {
		throw new Error(
			"RHE emit currently supports tipoDoc SIN DOCUMENTO only; RUC/DNI validation needs a separate captured flow",
		);
	}
	const descripcion = rejectControlChars(String(raw.descripcion || "").trim());
	if (!descripcion) throw new Error("descripcion cannot be empty");
	if (descripcion.length > 200) throw new Error(`descripcion too long: ${descripcion.length} chars (max 200)`);
	const fechaEmision = validateRHEFecha(String(raw.fechaEmision || peruToday()));
	return {
		empresa: validateEmpresa(String(raw.empresa || "")),
		tipoDoc,
		descripcion,
		monto: validateMonto(Number(raw.monto || raw.monto_pen || 0)),
		moneda: validateMoneda(String(raw.moneda || "PEN")),
		medioPago: validateMedioPago(String(raw.medioPago || "TRANSFERENCIA")),
		fechaEmision,
	};
}

function validateRHEFecha(value: string, now = new Date()): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid fechaEmision: expected YYYY-MM-DD, got "${value}"`);
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new Error(`Invalid fechaEmision: "${value}" is not a calendar date`);
	}
	const currentDay = new Date(`${peruToday(now)}T00:00:00Z`).getTime();
	const difference = Math.round((currentDay - date.getTime()) / 86_400_000);
	if (difference < 0) throw new Error("fechaEmision cannot be in the future");
	if (difference > 2)
		throw new Error("fechaEmision is outside the observed SUNAT window of today or the previous 2 days");
	return value;
}

function peruToday(now = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Lima",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

function parseCSV(csv: string): Record<string, string>[] {
	const lines = csv.trim().split("\n");
	const headers = lines[0].split(",").map((h) => h.trim());
	return lines.slice(1).map((line) => {
		const values = line.split(",").map((v) => v.trim());
		const obj: Record<string, string> = {};
		headers.forEach((h, i) => {
			obj[h] = values[i] || "";
		});
		return obj;
	});
}
