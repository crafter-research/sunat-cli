import { Command } from "commander";
import { loadLukeaCredentials } from "../../data/lukea-config.ts";
import { getMe } from "./api-client.ts";
import { outputError, outputSuccess } from "../../utils/output.ts";
import * as p from "@clack/prompts";

export function createLukeaWhoamiCommand(): Command {
	return new Command("whoami")
		.description("Mostrar cuenta Lukea conectada")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const creds = loadLukeaCredentials();
				if (!creds) {
					outputError(
						"No conectado a Lukea. Ejecuta: sunat-cli lukea login",
						format,
					);
					return;
				}

				const me = await getMe();
				const maskedKey = `lk_...${creds.apiKey.slice(-4)}`;

				if (isTTY) {
					console.log();
					if (me.name) {
						console.log(`  \x1b[1m${me.name}\x1b[0m`);
					}
					console.log(`  \x1b[2m${me.email}\x1b[0m`);
					console.log();

					if (me.connections.length > 0) {
						for (const conn of me.connections) {
							const status = conn.isActive
								? "\x1b[32mactivo\x1b[0m"
								: "\x1b[2minactivo\x1b[0m";
							console.log(
								`  RUC ${conn.ruc} · ${conn.usuario} · ${status}`,
							);
						}
						if (me.pendingPeriods > 0) {
							console.log(
								`  \x1b[33m${me.pendingPeriods} periodos pendientes\x1b[0m · \x1b[31mS/${me.totalDebt.toLocaleString("es-PE")}\x1b[0m`,
							);
						}
					} else {
						console.log("  \x1b[2mNo hay RUC conectado\x1b[0m");
					}

					console.log();
					console.log(`  \x1b[2m${creds.apiUrl} · ${maskedKey}\x1b[0m`);
					console.log();
				} else {
					outputSuccess(
						JSON.stringify({
							...me,
							apiUrl: creds.apiUrl,
							key: maskedKey,
						}),
						format,
					);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});
}
