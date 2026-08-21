import { getCredentials } from "../data/config.ts";
import { stripAnsi } from "../utils/style.ts";
import {
	captureTokenFromSession,
	hasFreshToken,
	RENTA_LOGIN_URL,
	readToken,
	rentaBrowser,
	storeToken,
} from "./session.ts";

/**
 * Log into e-renta and capture the F709 bearer token.
 *
 * The browser is needed for exactly this step. SUNAT's e-renta client is
 * registered for `authorization_code` only, so there is no password grant to
 * call: the token is minted during the interactive login and then reused
 * headless for its full hour.
 */

/** Fill one field with real key events and confirm the value landed. */
async function typeField(selector: string, value: string, label: string): Promise<void> {
	await rentaBrowser(["click", selector]);
	await rentaBrowser(["type", selector, value]);

	// Verify the length rather than the value, so a password never reaches a log.
	const raw = await rentaBrowser([
		"eval",
		`(() => (document.querySelector(${JSON.stringify(selector)})||{}).value?.length ?? -1)()`,
	]);
	const got = Number(stripAnsi(String(raw)).trim());
	if (got !== value.length) {
		throw new Error(
			`${label} did not land in the form (expected ${value.length} characters, got ${got}). ` +
				"SUNAT's login silently truncates on some inputs; retry, and if it persists check for a page change.",
		);
	}
}

export interface LoginResult {
	ruc: string;
	usuario: string;
	expiresAt: number;
	versionWeb: string;
	reused: boolean;
}

export async function loginRenta(force = false): Promise<LoginResult> {
	const creds = getCredentials();

	if (!force && hasFreshToken()) {
		const cached = readToken();
		return {
			ruc: creds.ruc,
			usuario: creds.usuario.toUpperCase(),
			expiresAt: cached?.expiresAt ?? 0,
			versionWeb: cached?.versionWeb ?? "",
			reused: true,
		};
	}

	await rentaBrowser(["open", RENTA_LOGIN_URL], 45000);
	await rentaBrowser(["wait", "--load", "networkidle"], 45000);

	// The accessibility tree on this login page comes back empty even though the
	// form is on screen, so drive it by CSS id rather than by snapshot ref.
	//
	// `type` and not `fill`: fill truncated the password to 7 of 10 characters,
	// and SUNAT answered "DNI y/o contrasena son incorrectos", a message that
	// points at the document type and hides the real cause. Verified 2026-08-21.
	await typeField("#txtRuc", creds.ruc, "RUC");
	await typeField("#txtUsuario", creds.usuario.toUpperCase(), "Usuario");
	await typeField("#txtContrasena", creds.password, "Password");

	await rentaBrowser(["click", "#btnAceptar"]);
	await rentaBrowser(["wait", "--load", "networkidle"], 45000);

	const url = String(await rentaBrowser(["get", "url"])).trim();
	if (url.includes("/oauth2/error")) {
		throw new Error("SUNAT rejected the Clave SOL credentials.");
	}

	const { token, versionWeb } = await captureTokenFromSession();
	storeToken(token, versionWeb);

	const stored = readToken();
	return {
		ruc: creds.ruc,
		usuario: creds.usuario.toUpperCase(),
		expiresAt: stored?.expiresAt ?? 0,
		versionWeb,
		reused: false,
	};
}

/** Guarantee a usable token, opening the browser only when the cache is cold. */
export async function ensureRentaToken(): Promise<void> {
	if (hasFreshToken()) return;
	await loginRenta(true);
}
