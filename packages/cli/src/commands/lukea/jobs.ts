import { Command } from "commander";
import { getJobs, getJob, updateJob } from "./api-client.ts";
import { outputError, output } from "../../utils/output.ts";
import { audit } from "../../data/audit.ts";
import { getCredentials } from "../../data/config.ts";
import { ensureSOLSession } from "../../browser/auth.ts";
import { emitRHE } from "../../workflows/rhe.ts";
import { declareF616 } from "../../workflows/f616.ts";
import { auditScreenshotPath } from "../../data/audit.ts";
import * as p from "@clack/prompts";

export function createLukeaJobsCommand(): Command {
	const jobs = new Command("jobs").description("Gestionar jobs de Lukea");

	jobs
		.command("list")
		.description("Listar jobs pendientes")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const spinner = isTTY ? p.spinner() : null;
				spinner?.start("Obteniendo jobs...");

				const list = await getJobs();

				spinner?.stop("Listo.");

				output(format, {
					json: list,
					table: {
						headers: ["ID", "TIPO", "PERIODO", "ESTADO"],
						rows: list.map((j) => [String(j.id), j.type, j.periodo, j.status]),
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});

	jobs
		.command("run <jobId>")
		.description("Ejecutar un job de Lukea")
		.action(async (jobId: string, _opts, cmd) => {
			const format = cmd.parent?.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const spinner = isTTY ? p.spinner() : null;
				spinner?.start(`Obteniendo job ${jobId}...`);

				const job = await getJob(jobId);

				spinner?.stop(`Job: ${job.type} — ${job.periodo}`);

				await updateJob(jobId, { status: "running" });

				const creds = getCredentials();

				let result: Record<string, unknown>;

				if (job.type === "rhe-emit") {
					await ensureSOLSession(creds);
					const input = job.input as Parameters<typeof emitRHE>[0];
					result = (await emitRHE(input, auditScreenshotPath("rhe-emit"))) as Record<string, unknown>;
				} else if (job.type === "f616-declare") {
					const input = job.input as Parameters<typeof declareF616>[0];
					result = (await declareF616(input, auditScreenshotPath("f616-declare"))) as Record<string, unknown>;
				} else {
					throw new Error(`Unknown job type: ${job.type}`);
				}

				await updateJob(jobId, { status: "success", result });

				audit({
					command: "lukea jobs run",
					args: { jobId, type: job.type, periodo: job.periodo },
					result: "success",
					details: result,
				});

				output(format, {
					json: { success: true, jobId, result },
					table: {
						headers: ["JOB ID", "TIPO", "PERIODO", "ESTADO"],
						rows: [[String(jobId), job.type, job.periodo, "success"]],
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({
					command: "lukea jobs run",
					args: { jobId },
					result: "error",
					details: { error: msg },
				});
				try {
					await updateJob(jobId, { status: "failed", error: msg });
				} catch {}
				outputError(msg, format);
			}
		});

	return jobs;
}
