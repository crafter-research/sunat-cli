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
					outputError("Not connected to Lukea. Run: sunat lukea login", format);
					return;
				}

				let email = creds.email;
				if (!email) {
					try {
						const me = await getMe();
						email = me.email;
					} catch {
						email = undefined;
					}
				}

				const maskedKey = `lk_...${creds.apiKey.slice(-4)}`;

				if (isTTY) {
					p.log.info(`Conectado a Lukea${email ? ` como ${email}` : ""}`);
					p.log.info(`API: ${creds.apiUrl}`);
					p.log.info(`Key: ${maskedKey}`);
				} else {
					outputSuccess(
						JSON.stringify({ email, apiUrl: creds.apiUrl, key: maskedKey }),
						format,
					);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});
}
