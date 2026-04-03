import { Command } from "commander";
import { getJob, getJobs, reportStep, updateJob, uploadScreenshot } from "./api-client.ts";
import { outputError } from "../../utils/output.ts";
import { audit, auditScreenshotPath } from "../../data/audit.ts";
import { getCredentials } from "../../data/config.ts";
import { ensureSOLSession } from "../../browser/auth.ts";
import { emitRHE } from "../../workflows/rhe.ts";
import { declareF616 } from "../../workflows/f616.ts";
import * as p from "@clack/prompts";

const TYPE_LABELS: Record<string, string> = {
	rhe_emission: "Emision RHE",
	f616_declaration: "Declaracion F616",
};

const STATUS_COLORS: Record<string, string> = {
	queued: "\x1b[2m",
	running: "\x1b[33m",
	success: "\x1b[32m",
	failed: "\x1b[31m",
	cancelled: "\x1b[2m",
};

export function createLukeaJobsCommand(): Command {
	const jobs = new Command("jobs").description("Gestionar jobs de Lukea");

	jobs
		.command("list")
		.description("Listar jobs")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.parent?.opts().output || "table";

			try {
				const list = await getJobs();

				if (format === "json") {
					console.log(JSON.stringify(list, null, 2));
					return;
				}

				console.log();

				if (list.length === 0) {
					console.log("  \x1b[2mNo hay jobs.\x1b[0m");
					console.log();
					console.log(
						"  Crea un job desde \x1b[4m\x1b[36mlukea.ai/dashboard\x1b[0m",
					);
					console.log(
						'  o haz click en \x1b[1m"Resolver"\x1b[0m en un periodo pendiente.',
					);
					console.log();
					return;
				}

				const idW = 6;
				const typeW = 22;
				const periodoW = 10;
				const statusW = 14;

				console.log(
					`  ${"ID".padEnd(idW)} ${"TIPO".padEnd(typeW)} ${"PERIODO".padEnd(periodoW)} ${"ESTADO".padEnd(statusW)}`,
				);
				console.log(`  ${"─".repeat(idW + typeW + periodoW + statusW + 3)}`);

				for (const job of list) {
					const color = STATUS_COLORS[job.status] || "";
					const label = TYPE_LABELS[job.type] || job.type;
					console.log(
						`  ${String(job.id).padEnd(idW)} ${label.padEnd(typeW)} ${job.periodo.padEnd(periodoW)} ${color}${job.status}\x1b[0m`,
					);
				}

				const queued = list.filter((j) => j.status === "queued");
				if (queued.length > 0) {
					console.log();
					console.log(
						`  \x1b[2m${queued.length} job${queued.length > 1 ? "s" : ""} en cola.\x1b[0m`,
					);
					console.log(
						`  \x1b[2mEjecuta:\x1b[0m \x1b[1m\x1b[36msunat-cli lukea jobs run ${queued[0].id}\x1b[0m`,
					);
				}

				console.log();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});

	jobs
		.command("run <jobId>")
		.description("Ejecutar un job")
		.action(async (jobId: string, _opts, cmd) => {
			const format = cmd.parent?.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			const startTime = Date.now();

			try {
				if (isTTY) {
					p.intro(`lukea jobs run ${jobId}`);
				}

				const spinner = isTTY ? p.spinner() : null;
				spinner?.start("Obteniendo detalles del job...");

				const job = await getJob(jobId);
				const label = TYPE_LABELS[job.type] || job.type;

				spinner?.stop(`${label} · ${job.periodo}`);

				if (job.status !== "queued") {
					if (isTTY) {
						p.log.warn(
							`Job ${jobId} tiene estado "${job.status}". Solo se pueden ejecutar jobs en estado "queued".`,
						);
						p.outro("Cancelado.");
					}
					return;
				}

				spinner?.start("Marcando como running...");
				await updateJob(jobId, { status: "running" });
				void reportStep(jobId, "job_started", `Status: queued -> running`);
				spinner?.stop("Estado: running");

				spinner?.start("Obteniendo credenciales SUNAT...");
				const creds = getCredentials();
				spinner?.stop(`RUC: ${creds.ruc}`);

				let result: Record<string, unknown>;

				if (job.type === "rhe_emission") {
					spinner?.start("Conectando a SUNAT SOL...");
					await ensureSOLSession(creds);
					void reportStep(jobId, "sunat_login", "SOL session established");
					spinner?.stop("Sesion SOL activa");

					void reportStep(jobId, "sunat_navigate", "Navigated to RHE emission form");
					spinner?.start("Emitiendo RHE...");
					void reportStep(jobId, "sunat_fill", `Periodo: ${job.periodo}`);
					const input = job.input as Parameters<typeof emitRHE>[0];
					const rheScreenshotPath = auditScreenshotPath("rhe-emit");
					result = (await emitRHE(
						input,
						rheScreenshotPath,
					)) as Record<string, unknown>;
					void reportStep(jobId, "sunat_submit", "RHE form submitted");
					void reportStep(jobId, "sunat_screenshot", "Screenshot saved");
					spinner?.stop("RHE emitido");
					spinner?.start("Subiendo screenshot...");
					const rheScreenshotUrl = await uploadScreenshot(jobId, rheScreenshotPath);
					if (rheScreenshotUrl) {
						void reportStep(jobId, "screenshot_uploaded", rheScreenshotUrl);
						spinner?.stop("Screenshot subido");
					} else {
						spinner?.stop("Screenshot no disponible");
					}
				} else if (job.type === "f616_declaration") {
					spinner?.start("Conectando a SUNAT Nueva Plataforma...");
					void reportStep(jobId, "sunat_login", "Nueva Plataforma session established");
					void reportStep(jobId, "sunat_navigate", "Navigated to F616 form (code 55.1.3.1.5)");
					const input = job.input as Parameters<typeof declareF616>[0];
					void reportStep(jobId, "sunat_fill", `Periodo set: ${job.periodo}`);
					const f616ScreenshotPath = auditScreenshotPath("f616-declare");
					result = (await declareF616(
						input,
						f616ScreenshotPath,
					)) as Record<string, unknown>;
					void reportStep(jobId, "sunat_submit", "F616 form submitted");
					void reportStep(jobId, "sunat_screenshot", "Screenshot saved");
					spinner?.stop("F616 declarado");
					spinner?.start("Subiendo screenshot...");
					const f616ScreenshotUrl = await uploadScreenshot(jobId, f616ScreenshotPath);
					if (f616ScreenshotUrl) {
						void reportStep(jobId, "screenshot_uploaded", f616ScreenshotUrl);
						spinner?.stop("Screenshot subido");
					} else {
						spinner?.stop("Screenshot no disponible");
					}
				} else {
					throw new Error(`Tipo de job desconocido: ${job.type}`);
				}

				spinner?.start("Reportando resultado a Lukea...");
				await updateJob(jobId, { status: "success", result });
				spinner?.stop("Resultado reportado");

				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

				audit({
					command: "lukea jobs run",
					args: { jobId, type: job.type, periodo: job.periodo },
					result: "success",
					details: result,
				});

				if (isTTY) {
					p.outro(`Completado en ${elapsed}s`);
				} else {
					console.log(JSON.stringify({ success: true, jobId, result }));
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({
					command: "lukea jobs run",
					args: { jobId },
					result: "error",
					details: { error: msg },
				});
				try {
					await updateJob(jobId, {
						status: "failed",
						errorMessage: msg,
					});
				} catch {}

				if (isTTY) {
					p.log.error(msg);
					p.outro("Fallido.");
				} else {
					outputError(msg, format);
				}
			}
		});

	return jobs;
}
