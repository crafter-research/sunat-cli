import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const SUNAT_DIR = join(process.env.HOME || "", ".sunat");
const CONFIG_FILE = join(SUNAT_DIR, "config.json");
const API_DIR = join(SUNAT_DIR, "api");
const SESSIONS_DIR = join(SUNAT_DIR, "sessions");
const AUDIT_DIR = join(SUNAT_DIR, "audit");

export interface SunatConfig {
	ruc?: string;
	usuario?: string;
	apiClientId?: string;
	apiClientSecret?: string;
}

export function ensureDirs(): void {
	for (const dir of [SUNAT_DIR, API_DIR, SESSIONS_DIR, AUDIT_DIR, join(AUDIT_DIR, "screenshots")]) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
}

export function loadConfig(): SunatConfig {
	ensureDirs();
	if (!existsSync(CONFIG_FILE)) return {};
	return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

export function saveConfig(config: SunatConfig): void {
	ensureDirs();
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getCredentials(): { ruc: string; usuario: string; password: string } {
	const config = loadConfig();
	const ruc = process.env.SUNAT_RUC || config.ruc;
	const usuario = process.env.SUNAT_USER || config.usuario;
	const password = process.env.SUNAT_PASSWORD;

	if (!ruc) throw new Error("RUC not configured. Set SUNAT_RUC env var or run: sunat config set ruc <value>");
	if (!usuario) throw new Error("Usuario not configured. Set SUNAT_USER env var or run: sunat config set usuario <value>");
	if (!password) throw new Error("Password not configured. Set SUNAT_PASSWORD env var");

	return { ruc, usuario, password };
}

export function getApiCredentials(): { clientId: string; clientSecret: string } {
	const config = loadConfig();
	const clientId = process.env.SUNAT_API_CLIENT_ID || config.apiClientId;
	const clientSecret = process.env.SUNAT_API_CLIENT_SECRET || config.apiClientSecret;

	if (!clientId || !clientSecret) {
		throw new Error("API credentials not configured. Set SUNAT_API_CLIENT_ID and SUNAT_API_CLIENT_SECRET env vars");
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
	apiToken: join(API_DIR, "token.json"),
	apiClient: join(API_DIR, "client.json"),
} as const;
