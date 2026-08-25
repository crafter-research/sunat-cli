import { existsSync, statSync } from "node:fs";
import { Command } from "commander";
import { loadConfig, paths } from "../data/config.ts";
import { emitNextSteps, type NextStep } from "../utils/next-steps.ts";
import { output } from "../utils/output.ts";

export function createWhoamiCommand(): Command {
	return new Command("whoami").description("Show current auth status").action((_, cmd) => {
		const format = cmd.parent?.opts().output || "auto";
		const config = loadConfig();

		const solSession = existsSync(paths.solSession);
		const solAge = solSession ? Date.now() - statSync(paths.solSession).mtimeMs : null;
		const nuevaSession = existsSync(paths.nuevaPlataformaSession);
		const nuevaAge = nuevaSession ? Date.now() - statSync(paths.nuevaPlataformaSession).mtimeMs : null;

		const data = {
			ruc: config.ruc || process.env.SUNAT_RUC || null,
			usuario: config.usuario || process.env.SUNAT_USER || null,
			sessions: {
				sol: {
					active: solSession,
					ageMinutes: solAge ? Math.round(solAge / 60000) : null,
					stale: solAge ? solAge > 20 * 60 * 1000 : true,
				},
				nuevaPlataforma: {
					active: nuevaSession,
					ageMinutes: nuevaAge ? Math.round(nuevaAge / 60000) : null,
					stale: nuevaAge ? nuevaAge > 20 * 60 * 1000 : true,
				},
			},
			api: {
				configured: !!config.apiClientId || !!process.env.SUNAT_API_CLIENT_ID,
			},
		};

		const steps: NextStep[] = [];
		if (!data.ruc || !data.usuario) {
			steps.push({ command: "sunat-cli login", description: "set RUC and usuario, then sign in" });
		} else if (data.sessions.sol.stale) {
			steps.push({ command: "sunat-cli login", description: "the SOL session is stale" });
		}

		output(format, {
			json: data,
			table: {
				headers: ["Property", "Value"],
				rows: [
					["RUC", data.ruc || "(not set)"],
					["Usuario", data.usuario || "(not set)"],
					["SOL Session", data.sessions.sol.active ? `active (${data.sessions.sol.ageMinutes}m)` : "none"],
					[
						"Nueva Plataforma",
						data.sessions.nuevaPlataforma.active ? `active (${data.sessions.nuevaPlataforma.ageMinutes}m)` : "none",
					],
					["API credentials", data.api.configured ? "configured" : "not configured"],
				],
			},
		});

		emitNextSteps(steps, format);
	});
}
