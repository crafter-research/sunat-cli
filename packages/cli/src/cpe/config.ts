/**
 * CPE-specific config (emisor + cert + SOL credentials for sunat-direct driver).
 *
 * Layered:
 * 1. Env vars (highest priority)
 * 2. ~/.sunat/cpe.json
 * 3. ~/.sunat/config.json (shared with RHE/F616, RUC + usuario only)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "../data/config.ts";

export interface CpeEmisor {
	ruc: string;
	razonSocial: string;
	nombreComercial?: string;
	ubigeo?: string;
	direccion?: string;
	codigoPais?: string;
}

export interface CpeProfile {
	emisor: CpeEmisor;
	mode: "beta" | "prod";
	driver: string;
	certPath?: string;
	solUsuario?: string;
}

export interface CpeConfig {
	defaultProfile?: string;
	profiles: Record<string, CpeProfile>;
}

const CPE_CONFIG_FILE = join(paths.sunatDir, "cpe.json");

export function loadCpeConfig(): CpeConfig {
	if (!existsSync(CPE_CONFIG_FILE)) return { profiles: {} };
	return JSON.parse(readFileSync(CPE_CONFIG_FILE, "utf-8")) as CpeConfig;
}

export function saveCpeConfig(config: CpeConfig): void {
	if (!existsSync(paths.sunatDir)) mkdirSync(paths.sunatDir, { recursive: true });
	writeFileSync(CPE_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export interface ResolvedCpeContext {
	emisor: CpeEmisor;
	mode: "beta" | "prod";
	certPath: string;
	certPassword: string;
	solUsuario: string;
	solPassword: string;
}

export function resolveCpeContext(profileName?: string): ResolvedCpeContext {
	const config = loadCpeConfig();
	const name = profileName || process.env.CPE_PROFILE || config.defaultProfile;
	const profile = name ? config.profiles[name] : undefined;

	const emisorRuc = process.env.CPE_EMISOR_RUC || profile?.emisor.ruc;
	const emisorRznSocial = process.env.CPE_EMISOR_RAZON_SOCIAL || profile?.emisor.razonSocial;
	if (!emisorRuc) throw new Error("Emisor RUC not configured. Set CPE_EMISOR_RUC env var or run 'sunat cpe profile set'.");
	if (!emisorRznSocial) throw new Error("Emisor razonSocial not configured. Set CPE_EMISOR_RAZON_SOCIAL env var.");

	const mode = (process.env.CPE_MODE || profile?.mode || "beta") as "beta" | "prod";
	const certPath = process.env.CPE_CERT_PATH || profile?.certPath;
	const certPassword = process.env.CPE_CERT_PASSWORD;
	const solUsuario = process.env.CPE_SOL_USUARIO || process.env.SUNAT_USER || profile?.solUsuario;
	const solPassword = process.env.CPE_SOL_PASSWORD || process.env.SUNAT_PASSWORD;

	if (!certPath) throw new Error("Certificate not configured. Set CPE_CERT_PATH env var (path to .pfx).");
	if (!certPassword) throw new Error("Certificate password missing. Set CPE_CERT_PASSWORD env var.");
	if (!solUsuario) throw new Error("SOL user missing. Set CPE_SOL_USUARIO or SUNAT_USER env var.");
	if (!solPassword) throw new Error("SOL password missing. Set CPE_SOL_PASSWORD or SUNAT_PASSWORD env var.");

	return {
		emisor: {
			ruc: emisorRuc,
			razonSocial: emisorRznSocial,
			nombreComercial: process.env.CPE_EMISOR_NOMBRE_COMERCIAL || profile?.emisor.nombreComercial,
			ubigeo: process.env.CPE_EMISOR_UBIGEO || profile?.emisor.ubigeo,
			direccion: process.env.CPE_EMISOR_DIRECCION || profile?.emisor.direccion,
			codigoPais: profile?.emisor.codigoPais || "PE",
		},
		mode,
		certPath,
		certPassword,
		solUsuario,
		solPassword,
	};
}
