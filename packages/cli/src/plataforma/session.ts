import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { privateChildEnv } from "../data/child-process.ts";
import { paths } from "../data/config.ts";
import { secureExistingFile, writePrivateFile } from "../data/private-storage.ts";

/**
 * Nueva Plataforma (e-plataformaunica.sunat.gob.pe) session token, a.k.a. IdCache.
 *
 * SUNAT's Declaraciones y Pagos forms (F616, F1683, ...) are jQuery SPAs over a
 * JSON API. The API authenticates with an `IdCache` header: a JWT that SUNAT's
 * OWN portal client (clientId 59d39217-...) mints during the browser login,
 * with `aud = e-plataformaunica` and a 3600s life.
 *
 * A self-registered API client cannot obtain that audience: SUNAT only grants
 * `contribuyente/*` and `controladuanero/*` scopes at registration, so the token
 * has to be captured from the browser once, then reused headless until it
 * expires. Verified 2026-08-09: the captured token answers the API with the
 * browser fully closed.
 */

const SESSION = "sunat";
const CACHE_FILE = join(paths.sunatDir, "plataforma-token.json");

export const PLATAFORMA_BASE = "https://e-plataformaunica.sunat.gob.pe";

interface CachedToken {
	idCache: string;
	/** epoch seconds */
	expiresAt: number;
	capturedAt: number;
}

function stripAnsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal color codes
	return s.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

function decodeExp(jwt: string): number {
	const part = jwt.split(".")[1];
	if (!part) throw new Error("IdCache is not a JWT");
	const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
	const claims = JSON.parse(Buffer.from(padded, "base64url").toString());
	if (!claims.exp) throw new Error("IdCache has no exp claim");
	return claims.exp as number;
}

/**
 * Read the IdCache out of the browser session's captured network log.
 *
 * The token rides as the `idCache=` query parameter on the `servletAcceso`
 * navigation request. It is not in the top frame URL or sessionStorage of the
 * parent frame (both checked, both empty), because the form lives in an iframe.
 */
export async function captureIdCacheFromSession(): Promise<string> {
	const requests = await new Promise<string>((resolve, reject) => {
		const proc = spawn("agent-browser", ["--session", SESSION, "network", "requests"], {
			env: privateChildEnv(process.env, [], ["AGENT_BROWSER_"]),
			timeout: 15000,
		});
		let out = "";
		proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
		proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error("network requests failed"))));
		proc.on("error", reject);
	});

	const match = stripAnsi(requests).match(/idCache=(ey[A-Za-z0-9._-]+)/);
	if (!match) {
		throw new Error(
			"No IdCache in the session's network log. Navigate into a Nueva Plataforma form first (it appears on the servletAcceso request).",
		);
	}
	return match[1];
}

function loadCached(): CachedToken | null {
	if (!existsSync(CACHE_FILE)) return null;
	try {
		secureExistingFile(CACHE_FILE);
		return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
	} catch {
		return null;
	}
}

function saveCached(token: CachedToken): void {
	writePrivateFile(CACHE_FILE, JSON.stringify(token, null, 2));
}

/** True when a cached token exists and has more than 60s of life left. */
export function hasFreshToken(): boolean {
	const cached = loadCached();
	if (!cached) return false;
	return cached.expiresAt > Math.floor(Date.now() / 1000) + 60;
}

/**
 * Persist a freshly captured IdCache. The caller owns the browser step; this
 * module only stores what was captured and tracks its expiry.
 */
export function storeIdCache(idCache: string): CachedToken {
	const expiresAt = decodeExp(idCache);
	const token: CachedToken = { idCache, expiresAt, capturedAt: Math.floor(Date.now() / 1000) };
	saveCached(token);
	return token;
}

/** Return a still-valid IdCache from cache, or throw asking for a browser capture. */
export function requireIdCache(): string {
	const cached = loadCached();
	if (!cached || cached.expiresAt <= Math.floor(Date.now() / 1000) + 60) {
		throw new Error(
			"No fresh Nueva Plataforma token. Run a command that opens the browser to capture one (it lasts 1 hour).",
		);
	}
	return cached.idCache;
}

/** Headless GET against the Nueva Plataforma API with the cached IdCache. */
export async function plataformaGet(path: string): Promise<unknown> {
	const idCache = requireIdCache();
	const url = path.startsWith("http") ? path : `${PLATAFORMA_BASE}${path}`;
	const resp = await fetch(url, {
		headers: { IdCache: idCache, IdFormulario: "*MENU*", Accept: "application/json" },
	});
	const text = await resp.text();
	if (!resp.ok) {
		throw new Error(`Plataforma API request failed with HTTP ${resp.status}`);
	}
	if (!text.trim()) {
		throw new Error("Plataforma API returned an empty body");
	}
	return JSON.parse(text);
}
