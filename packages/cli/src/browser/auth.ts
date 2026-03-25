import * as browser from "./client.ts";
import { solveReCaptcha } from "./captcha.ts";
import { existsSync, statSync } from "fs";
import { paths } from "../data/config.ts";

const SOL_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm";
const NUEVA_PLATAFORMA_URL =
	"https://api-seguridad.sunat.gob.pe/oauth2/login?originalUrl=https://e-menu.sunat.gob.pe/cl-ti-itmenu2/AutenticaMenuInternetPlataforma.htm";

const SESSION_MAX_AGE_MS = 18 * 60 * 1000;

interface Credentials {
	ruc: string;
	usuario: string;
	password: string;
}

function isSessionFresh(path: string): boolean {
	if (!existsSync(path)) return false;
	const age = Date.now() - statSync(path).mtimeMs;
	return age < SESSION_MAX_AGE_MS;
}

export async function ensureSOLSession(creds: Credentials): Promise<void> {
	if (isSessionFresh(paths.solSession)) {
		try {
			await browser.stateLoad(paths.solSession);
			const url = await browser.getUrl();
			if (url.includes("MenuInternet") && url.includes("pestana")) return;
		} catch {}
	}
	await loginSOL(creds);
}

export async function loginSOL(creds: Credentials): Promise<void> {
	await browser.open(SOL_URL, { headed: true });
	await browser.sleep(3000);

	let snap = await browser.snapshot({ interactive: true });

	if (snap.includes("Bienvenido")) {
		await browser.stateSave(paths.solSession);
		return;
	}

	const rucRef = extractRef(snap, "RUC", "textbox");
	const userRef = extractRef(snap, "Usuario", "textbox");
	const passRef = extractRef(snap, "Contraseña", "textbox");
	const submitRef = extractRef(snap, "Iniciar sesión", "button");

	await browser.fill(rucRef, creds.ruc);
	await browser.fill(userRef, creds.usuario.toUpperCase());
	await browser.fill(passRef, creds.password);
	await browser.click(submitRef);
	await browser.sleep(5000);

	const url = await browser.getUrl();
	if (!url.includes("pestana")) {
		snap = await browser.snapshot({ interactive: true });
		if (snap.includes("Bienvenido")) {
			await browser.stateSave(paths.solSession);
			return;
		}
		throw new Error(`SOL login failed. URL: ${url}`);
	}

	await browser.stateSave(paths.solSession);
}

export async function loginNuevaPlataforma(creds: Credentials): Promise<void> {
	await browser.killDaemon();
	await browser.open(NUEVA_PLATAFORMA_URL, { headed: true });
	await browser.sleep(3000);

	let snap = await browser.snapshot({ interactive: true });

	// Switch to RUC mode if needed
	const rucBtnRef = extractRefSafe(snap, "Ingresa por RUC", "button");
	if (rucBtnRef) {
		await browser.click(rucBtnRef);
		await browser.sleep(1000);
		snap = await browser.snapshot({ interactive: true });
	}

	const rucRef = extractRef(snap, "RUC", "textbox");
	const userRef = extractRef(snap, "Usuario", "textbox");
	const passRef = extractRef(snap, "Contraseña", "textbox");

	await browser.fill(rucRef, creds.ruc);
	await browser.fill(userRef, creds.usuario.toUpperCase());
	await browser.fill(passRef, creds.password);

	// Auto-solve reCAPTCHA via mouse coordinates
	console.log("  Solving reCAPTCHA...");
	const solved = await solveReCaptcha();
	if (!solved) {
		console.log("  reCAPTCHA not found — solve manually in browser window");
	}
	await browser.sleep(2000);

	// Click submit
	const submitRef = extractRef(snap, "Iniciar sesión", "button") || extractRef(snap, "Iniciar Sesión", "button");
	await browser.click(submitRef);
	await browser.sleep(8000);

	const url = await browser.getUrl();
	if (url.includes("Plataforma") || url.includes("declapago") || url.includes("code=")) {
		await browser.stateSave(paths.nuevaPlataformaSession);
		return;
	}

	// Fallback: wait for manual login
	console.log("  Auto-login may have failed. Check the browser window...");
	for (let i = 0; i < 60; i++) {
		await browser.sleep(2000);
		try {
			const u = await browser.getUrl();
			if (u.includes("Plataforma") || u.includes("declapago")) {
				await browser.stateSave(paths.nuevaPlataformaSession);
				return;
			}
		} catch {}
	}
	throw new Error("Nueva Plataforma login timed out");
}

function extractRef(snap: string, label: string, type: string): string {
	const ref = extractRefSafe(snap, label, type);
	if (!ref) throw new Error(`Could not find ${type} "${label}" in page`);
	return ref;
}

function extractRefSafe(snap: string, label: string, type: string): string | null {
	for (const line of snap.split("\n")) {
		if (line.includes(type) && line.toLowerCase().includes(label.toLowerCase())) {
			const m = line.match(/ref=(e\d+)/);
			if (m) return `@${m[1]}`;
		}
	}
	for (const line of snap.split("\n")) {
		if (line.toLowerCase().includes(label.toLowerCase())) {
			const m = line.match(/ref=(e\d+)/);
			if (m) return `@${m[1]}`;
		}
	}
	return null;
}
