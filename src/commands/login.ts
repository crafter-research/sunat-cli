import { Command } from "commander";
import { getCredentials } from "../data/config.ts";
import { loginSOL, loginNuevaPlataforma } from "../browser/auth.ts";
import { outputSuccess, outputError } from "../utils/output.ts";
import { audit } from "../data/audit.ts";

export function createLoginCommand(): Command {
	return new Command("login")
		.description("Authenticate with SUNAT Clave SOL")
		.option("--nueva-plataforma", "Login to Nueva Plataforma (requires reCAPTCHA)")
		.action(async (opts, cmd) => {
			const format = cmd.parent?.opts().output || "table";
			const portal = opts.nuevaPlataforma ? "nueva-plataforma" : "sol";
			try {
				const creds = getCredentials();
				if (opts.nuevaPlataforma) {
					await loginNuevaPlataforma(creds);
				} else {
					await loginSOL(creds);
				}
				audit({ command: "login", args: { portal }, result: "success" });
				outputSuccess(`Logged in to ${portal === "sol" ? "SOL (RHE)" : "Nueva Plataforma (F616)"}`, format);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({ command: "login", args: { portal }, result: "error", details: { error: msg } });
				outputError(msg, format);
			}
		});
}
