import * as browser from "../browser/client.ts";
import { setInputValueInIframe } from "../browser/cdp.ts";
import { getCredentials } from "../data/config.ts";

export interface F616Input {
	periodo: string;
	telefono?: string;
	profesion?: string;
}

export interface F616Result {
	periodo: string;
	ingresoBruto?: number;
	retencion4ta?: number;
	pagoACuenta?: number;
	screenshot?: string;
}

const NUEVA_PLATAFORMA_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?exe=55.1.1.1.1";
const F616_MENU_CODE = "55.1.3.1.5";

export async function loginNuevaPlataforma(): Promise<void> {
	await browser.open(NUEVA_PLATAFORMA_URL, { headed: true });
	await browser.sleep(3000);

	const snap = await browser.snapshot({ interactive: true });
	if (snap.includes("Bienvenido") || snap.includes("pestana")) return;

	const creds = getCredentials();
	const rucRef = findRef(snap, "RUC", "textbox");
	const userRef = findRef(snap, "Usuario", "textbox");
	const passRef = findRef(snap, "Contraseña", "textbox");
	const submitRef = findRef(snap, "Iniciar sesión", "button");

	await browser.fill(rucRef, creds.ruc);
	await browser.fill(userRef, creds.usuario.toUpperCase());
	await browser.fill(passRef, creds.password);
	await browser.click(submitRef);
	await browser.sleep(8000);

	const url = await browser.getUrl();
	if (!url.includes("pestana")) {
		throw new Error(`Nueva Plataforma login failed. URL: ${url}`);
	}
}

export async function navigateToF616(): Promise<void> {
	await browser.evalJS(
		`ejecuta('MenuInternetPlataforma.htm?action=iconExecute&code=${F616_MENU_CODE}', false, 'Trabajadores Independientes - 616', '#nivel1_55', '${F616_MENU_CODE}')`,
	);
	await browser.sleep(5000);

	const snap = await browser.snapshot({ interactive: true });
	if (!snap.includes("0616") && !snap.includes("Trabajadores Independientes")) {
		throw new Error("F616 form did not load");
	}
}

export async function declareF616(input: F616Input, screenshotPath?: string): Promise<F616Result> {
	// Step 1: Set periodo via CDP (bypasses input mask)
	const periodoFormatted = formatPeriodo(input.periodo);
	await setInputValueInIframe("casilla007", periodoFormatted);
	await browser.sleep(1000);

	// Fill telefono if provided
	let snap = await browser.snapshot({ interactive: true });
	if (input.telefono) {
		const telRef = findRefSafe(snap, "textbox", null, "required");
		if (telRef && telRef !== findRefSafe(snap, "mm/aaaa", "textbox")) {
			const allTextboxes = findAllRefs(snap, "textbox", "required");
			const telField = allTextboxes.find((r) => r !== findRefSafe(snap, "mm/aaaa", "textbox"));
			if (telField) await browser.fill(telField, input.telefono);
		}
	}

	// Select profesion if provided
	if (input.profesion) {
		const profRef = findRefSafe(snap, "combobox", null);
		if (profRef) {
			await browser.select(profRef, input.profesion);
		}
	}

	// Click Siguiente to go to Detalle de Ingresos
	const sigRef = findRef(snap, "Siguiente", "button");
	await browser.click(sigRef);
	await browser.sleep(3000);

	// Dismiss "no income data" modal if it appears
	snap = await browser.snapshot({ interactive: true });
	const acceptRef = findRefSafe(snap, "Aceptar", "button");
	if (acceptRef) {
		await browser.click(acceptRef);
		await browser.sleep(2000);
	}

	// Click "Detalle de Ingresos" tab
	const detalleRef = findRefSafe(snap, "Detalle de Ingresos", "link");
	if (detalleRef) {
		await browser.click(detalleRef);
		await browser.sleep(2000);
	}

	// Click "Determinacion de la Deuda" tab to see the calculation
	snap = await browser.snapshot({ interactive: true });
	const deudaRef = findRefSafe(snap, "Determinación de la Deuda", "link") || findRefSafe(snap, "Determinacion", "link");
	if (deudaRef) {
		await browser.click(deudaRef);
		await browser.sleep(3000);
	}

	if (screenshotPath) {
		await browser.screenshot(screenshotPath);
	}

	snap = await browser.snapshot({ interactive: true });

	// Navigate back to F616 list for next declaration
	await browser.clearBeforeUnload();

	return {
		periodo: input.periodo,
		screenshot: screenshotPath,
	};
}

export async function ensureNuevaPlataformaAndF616(): Promise<void> {
	const url = await browser.getUrl();

	if (!url.includes("itmenu2") || !url.includes("pestana")) {
		const creds = getCredentials();
		await browser.open("https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm", { headed: true });
		await browser.sleep(3000);

		let snap = await browser.snapshot({ interactive: true });
		if (!snap.includes("Bienvenido")) {
			const rucRef = findRef(snap, "RUC", "textbox");
			const userRef = findRef(snap, "Usuario", "textbox");
			const passRef = findRef(snap, "Contraseña", "textbox");
			const submitRef = findRef(snap, "Iniciar sesión", "button");
			await browser.fill(rucRef, creds.ruc);
			await browser.fill(userRef, creds.usuario.toUpperCase());
			await browser.fill(passRef, creds.password);
			await browser.click(submitRef);
			await browser.sleep(5000);
		}

		await loginNuevaPlataforma();
	}

	await navigateToF616();
}

function formatPeriodo(periodo: string): string {
	if (periodo.includes("/")) return periodo;
	const [year, month] = periodo.split("-");
	return `${month}/${year}`;
}

function findRef(snap: string, text: string, type: string): string {
	const ref = findRefSafe(snap, text, type);
	if (!ref) throw new Error(`Element not found: ${type} "${text}"`);
	return ref;
}

function findRefSafe(snap: string, text: string, type: string | null, extraMatch?: string): string | null {
	for (const line of snap.split("\n")) {
		const matchesType = !type || line.includes(type);
		const matchesText = line.toLowerCase().includes(text.toLowerCase());
		const matchesExtra = !extraMatch || line.includes(extraMatch);
		const notDisabled = !line.includes("disabled");
		if (matchesType && matchesText && matchesExtra && notDisabled) {
			const m = line.match(/ref=(e\d+)/);
			if (m) return `@${m[1]}`;
		}
	}
	return null;
}

function findAllRefs(snap: string, type: string, extraMatch?: string): string[] {
	const refs: string[] = [];
	for (const line of snap.split("\n")) {
		if (line.includes(type) && !line.includes("disabled") && (!extraMatch || line.includes(extraMatch))) {
			const m = line.match(/ref=(e\d+)/);
			if (m) refs.push(`@${m[1]}`);
		}
	}
	return refs;
}
