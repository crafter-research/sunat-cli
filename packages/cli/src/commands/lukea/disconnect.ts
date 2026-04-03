import { Command } from "commander";
import { deleteLukeaCredentials, loadLukeaCredentials } from "../../data/lukea-config.ts";
import { outputError, outputSuccess } from "../../utils/output.ts";
import { audit } from "../../data/audit.ts";
import * as p from "@clack/prompts";

export function createLukeaDisconnectCommand(): Command {
	return new Command("disconnect")
		.description("Desconectar sunat-cli de Lukea")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const creds = loadLukeaCredentials();
				if (!creds) {
					outputError("Not connected to Lukea.", format);
					return;
				}

				deleteLukeaCredentials();

				audit({ command: "lukea disconnect", args: {}, result: "success" });

				if (isTTY) {
					p.log.success("Desconectado de Lukea.");
				} else {
					outputSuccess("Disconnected from Lukea", format);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});
}
