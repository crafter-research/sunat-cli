import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { missingSecretMessage, resolveSecret } from "./keychain.ts";
import { ensurePrivateDir, secureExistingFile, writePrivateFile } from "./private-storage.ts";

/**
 * Root of all on-disk state. `SUNAT_HOME` overrides it so tests and smoke runs
 * can point at a scratch dir instead of the operator's live sessions, tokens
 * and audit log. Every path under the home dir must be composed from this.
 */
export function resolveSunatDir(): string {
	const override = process.env.SUNAT_HOME;
	if (override) return override;
	return join(process.env.HOME || "", ".sunat");
}

const SUNAT_DIR = resolveSunatDir();
const CONFIG_FILE = join(SUNAT_DIR, "config.json");
const API_DIR = join(SUNAT_DIR, "api");
const SESSIONS_DIR = join(SUNAT_DIR, "sessions");
const AUDIT_DIR = join(SUNAT_DIR, "audit");

export interface SunatConfig {
	ruc?: string;
	usuario?: string;
	apiClientId?: string;
}

function sanitizeConfig(config: Record<string, unknown>): SunatConfig {
	return {
		...(typeof config.ruc === "string" ? { ruc: config.ruc } : {}),
		...(typeof config.usuario === "string" ? { usuario: config.usuario } : {}),
		...(typeof config.apiClientId === "string" ? { apiClientId: config.apiClientId } : {}),
	};
}

export function ensureDirs(): void {
	for (const dir of [SUNAT_DIR, API_DIR, SESSIONS_DIR, AUDIT_DIR]) {
		ensurePrivateDir(dir);
	}
	secureExistingFile(CONFIG_FILE);
}

export function loadConfig(): SunatConfig {
	ensureDirs();
	if (!existsSync(CONFIG_FILE)) return {};
	const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>;
	const config = sanitizeConfig(raw);
	if (Object.keys(raw).some((key) => !["ruc", "usuario", "apiClientId"].includes(key))) saveConfig(config);
	return config;
}

export function saveConfig(config: SunatConfig): void {
	ensureDirs();
	writePrivateFile(CONFIG_FILE, JSON.stringify(sanitizeConfig(config as Record<string, unknown>), null, 2));
}

export function getCredentials(): { ruc: string; usuario: string; password: string } {
	const config = loadConfig();
	const ruc = process.env.SUNAT_RUC || config.ruc;
	const usuario = process.env.SUNAT_USER || config.usuario;
	const password = resolveSecret(["SUNAT_PASSWORD"]);

	if (!ruc) throw new Error("RUC not configured. Set SUNAT_RUC env var or run: sunat-cli config set ruc <value>");
	if (!usuario)
		throw new Error("Usuario not configured. Set SUNAT_USER env var or run: sunat-cli config set usuario <value>");
	if (!password) throw new Error(missingSecretMessage(["SUNAT_PASSWORD"], "Password"));

	return { ruc, usuario, password };
}

export function getApiCredentials(): { clientId: string; clientSecret: string } {
	const config = loadConfig();
	const clientId = process.env.SUNAT_API_CLIENT_ID || config.apiClientId;
	const clientSecret = resolveSecret(["SUNAT_API_CLIENT_SECRET"]);

	if (!clientId || !clientSecret) {
		throw new Error(
			"API credentials not configured. Set SUNAT_API_CLIENT_ID env var and SUNAT_API_CLIENT_SECRET env var or keychain secret",
		);
	}

	return { clientId, clientSecret };
}

export const paths = {
	sunatDir: SUNAT_DIR,
	config: CONFIG_FILE,
	apiDir: API_DIR,
	sessionsDir: SESSIONS_DIR,
	auditDir: AUDIT_DIR,
	solSession: join(SESSIONS_DIR, "sol.json"),
	nuevaPlataformaSession: join(SESSIONS_DIR, "nueva-plataforma.json"),
} as const;
