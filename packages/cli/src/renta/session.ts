import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * e-renta (e-renta.sunat.gob.pe) session token.
 *
 * The F709 (Renta Anual - Persona Natural) is an Angular SPA over a JSON API.
 * Unlike the Nueva Plataforma forms, it authenticates with a plain
 * `Authorization: Bearer` JWT, which SUNAT's own e-renta client
 * (clientId 03590141-c69c-438c-a36a-8ee2a3ad9747) mints during the browser
 * login, with `aud = e-renta` scoped to `/v1/recaudacion/declaracionespago`
 * and a 3600s life.
 *
 * This is a DIFFERENT audience from the Nueva Plataforma IdCache: a token
 * captured for F616 does not authorize e-renta and vice versa. Verified
 * 2026-08-21 by decoding both.
 *
 * The SPA stores the token in sessionStorage under `SUNAT.token`, so unlike
 * the F616 (where the token hides in an iframe's query string) it can be read
 * straight out of the page. Verified 2026-08-21: the captured token answers the
 * API with the browser fully closed; the same request without it returns 401.
 */

const SESSION = "sunat-renta";
const CACHE_DIR = join(homedir(), ".sunat");
const CACHE_FILE = join(CACHE_DIR, "renta-token.json");

export const RENTA_BASE = "https://e-renta.sunat.gob.pe";
export const RENTA_API = `${RENTA_BASE}/v1/recaudacion/declaracionespago/renta`;

/** SUNAT's own e-renta OAuth client. Not ours, and not the Nueva Plataforma one. */
const RENTA_CLIENT_ID = "03590141-c69c-438c-a36a-8ee2a3ad9747";

/**
 * Where the SPA lands after login. Note this is `/formularios`, NOT the
 * `/personas?idFormulario=for0709` that e-renta's root redirects to: that path
 * answers nginx 500 unconditionally, session or not.
 */
const RENTA_LANDING = `${RENTA_BASE}/loader/recaudaciontributaria/declaracionpago/formularios`;

export const RENTA_LOGIN_URL = `https://api-seguridad.sunat.gob.pe/v1/clientessol/${RENTA_CLIENT_ID}/oauth2/login?originalUrl=${encodeURIComponent(RENTA_LANDING)}`;

/**
 * Client version the API demands. Sent as `version-web`.
 *
 * Load-bearing: without it `predeclaracion` answers HTTP 422 / 42209
 * "esta version esta obsoleta". Isolated by contrast 2026-08-21 — header-name
 * variants (`version`, `x-version`, `App-Version`, `versionApp`) all still 422.
 *
 * SUNAT bumps this on each client release. `readVersionFromSession()` reads the
 * live value out of the SPA so a bump does not require a release here; this is
 * only the fallback.
 */
export const RENTA_VERSION_FALLBACK = "v4.3.12";

interface CachedToken {
	token: string;
	/** epoch seconds */
	expiresAt: number;
	capturedAt: number;
	/** the `version-web` value observed alongside this token */
	versionWeb: string;
}

function stripAnsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal color codes
	return s.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

function decodeExp(jwt: string): number {
	const part = jwt.split(".")[1];
	if (!part) throw new Error("e-renta token is not a JWT");
	const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
	const claims = JSON.parse(Buffer.from(padded, "base64url").toString());
	if (!claims.exp) throw new Error("e-renta token has no exp claim");
	return claims.exp as number;
}

/** Run one agent-browser subcommand against the renta session. */
async function browser(args: string[], timeout = 20000): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const proc = spawn("agent-browser", ["--session", SESSION, ...args], { timeout });
		let out = "";
		let err = "";
		proc.stdout.on("data", (d: Buffer) => {
			out += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			err += d.toString();
		});
		proc.on("error", () => reject(new Error("agent-browser not found. Install it: npm i -g agent-browser")));
		proc.on("close", (code) =>
			code === 0 ? resolve(out) : reject(new Error(`agent-browser ${args[0]} failed: ${stripAnsi(err) || code}`)),
		);
	});
}

/**
 * Read a sessionStorage key out of the live SPA.
 *
 * `eval` returns the value JSON-encoded, so the result is double-decoded: once
 * for agent-browser's own envelope, once for the stored string.
 */
async function readSessionStorage(key: string): Promise<string | null> {
	const raw = await browser(["eval", `(() => sessionStorage.getItem(${JSON.stringify(key)}))()`]);
	const trimmed = stripAnsi(raw);
	if (!trimmed || trimmed === "null") return null;
	try {
		const decoded = JSON.parse(trimmed);
		return typeof decoded === "string" ? decoded : null;
	} catch {
		return null;
	}
}

/** The `version-web` the live SPA is sending, so a SUNAT bump does not break us. */
export async function readVersionFromSession(): Promise<string> {
	const v = await readSessionStorage("SUNAT.Version");
	return v || RENTA_VERSION_FALLBACK;
}

export async function captureTokenFromSession(): Promise<{ token: string; versionWeb: string }> {
	const token = await readSessionStorage("SUNAT.token");
	if (!token) {
		throw new Error("No e-renta token in the browser session. The login may not have completed.");
	}
	const versionWeb = await readVersionFromSession();
	return { token, versionWeb };
}

export function storeToken(token: string, versionWeb: string): void {
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
	const payload: CachedToken = {
		token,
		expiresAt: decodeExp(token),
		capturedAt: Math.floor(Date.now() / 1000),
		versionWeb,
	};
	writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function readToken(): CachedToken | null {
	if (!existsSync(CACHE_FILE)) return null;
	try {
		return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CachedToken;
	} catch {
		return null;
	}
}

/** Fresh with 60s of margin, so a token does not expire mid-request. */
export function hasFreshToken(): boolean {
	const cached = readToken();
	if (!cached) return false;
	return cached.expiresAt - 60 > Math.floor(Date.now() / 1000);
}

export { browser as rentaBrowser, CACHE_FILE as RENTA_TOKEN_FILE, SESSION as RENTA_SESSION };
