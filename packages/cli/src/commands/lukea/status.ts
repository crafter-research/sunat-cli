import { Command } from "commander";
import { getConnections } from "./api-client.ts";
import { outputError, output } from "../../utils/output.ts";
import * as p from "@clack/prompts";

export function createLukeaStatusCommand(): Command {
	return new Command("status")
		.description("Diagnóstico fiscal desde Lukea")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const spinner = isTTY ? p.spinner() : null;
				spinner?.start("Obteniendo diagnóstico...");

				const connections = await getConnections();

				spinner?.stop("Listo.");

				output(format, {
					json: connections,
					table: {
						headers: ["ID", "RUC", "EMAIL"],
						rows: connections.map((c) => [c.id, c.ruc, c.email || ""]),
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});
}
