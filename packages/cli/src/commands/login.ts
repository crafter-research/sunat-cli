import * as p from "@clack/prompts";
import { Command } from "commander";
import { loginNuevaPlataforma, loginSOL } from "../browser/auth.ts";
import { audit } from "../data/audit.ts";
import { ensureDirs, loadConfig, saveConfig } from "../data/config.ts";
import { resolveSecret } from "../data/keychain.ts";
import { outputError, outputSuccess } from "../utils/output.ts";
import { installSkill, isSkillInstalled } from "../utils/skill.ts";

interface LoginOpts {
	nuevaPlataforma?: boolean;
	ruc?: string;
	user?: string;
}

async function getOrPromptCredentials(
	opts: LoginOpts,
	isTTY: boolean,
): Promise<{ ruc: string; usuario: string; password: string }> {
	const config = loadConfig();
	let ruc = opts.ruc || process.env.SUNAT_RUC || config.ruc;
	let usuario = opts.user || process.env.SUNAT_USER || config.usuario;
	let password = resolveSecret(["SUNAT_PASSWORD"]);

	if (ruc && usuario && password) {
		return { ruc, usuario, password };
	}

	if (!isTTY) {
		throw new Error(
			"Missing credentials. Pass --ruc and --user, set SUNAT_RUC, SUNAT_USER and SUNAT_PASSWORD, or store SUNAT_PASSWORD with sunat-cli keychain set",
		);
	}

	p.intro("sunat-cli login -- first time setup");

	if (!ruc) {
		const value = await p.text({
			message: "RUC (11 digits)",
			placeholder: "10XXXXXXXXX",
			validate: (v) => {
				if (!/^\d{11}$/.test(v)) return "RUC must be 11 digits";
			},
		});
		if (p.isCancel(value)) {
			p.cancel("Login cancelled");
			process.exit(0);
		}
		ruc = value;
	}

	if (!usuario) {
		const value = await p.text({
			message: "Usuario SOL",
			placeholder: "XXXXXXXX",
			validate: (v) => {
				if (!v.trim()) return "Required";
			},
		});
		if (p.isCancel(value)) {
			p.cancel("Login cancelled");
			process.exit(0);
		}
		usuario = value;
	}

	if (!password) {
		const value = await p.password({
			message: "Clave SOL",
			validate: (v) => {
				if (!v.trim()) return "Required";
			},
		});
		if (p.isCancel(value)) {
			p.cancel("Login cancelled");
			process.exit(0);
		}
		password = value;
	}

	ensureDirs();
	saveConfig({ ...config, ruc, usuario });
	p.log.success(`Credentials saved to ~/.sunat/config.json (password NOT stored)`);

	return { ruc, usuario, password };
}

export function createLoginCommand(): Command {
	return new Command("login")
		.description("Authenticate with SUNAT Clave SOL")
		.option("--nueva-plataforma", "Login to Nueva Plataforma (requires reCAPTCHA)")
		.option("--ruc <ruc>", "RUC number (11 digits)")
		.option("--user <usuario>", "SOL username")
		.action(async (opts: LoginOpts, cmd) => {
			const format = cmd.parent?.opts().output || "table";
			const portal = opts.nuevaPlataforma ? "nueva-plataforma" : "sol";
			const isTTY = process.stdout.isTTY && format !== "json";
			try {
				const creds = await getOrPromptCredentials(opts, isTTY);
				if (opts.nuevaPlataforma) {
					await loginNuevaPlataforma(creds);
				} else {
					await loginSOL(creds);
				}
				audit({ command: "login", args: { portal }, result: "success" });
				outputSuccess(`Logged in to ${portal === "sol" ? "SOL (RHE)" : "Nueva Plataforma (F616)"}`, format);

				if (!isSkillInstalled()) {
					await installSkill(isTTY);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({ command: "login", args: { portal }, result: "error", details: { error: msg } });
				outputError(msg, format);
			}
		});
}
