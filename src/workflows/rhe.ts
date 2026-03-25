import * as browser from "../browser/client.ts";
import type { TipoDocumento, MedioPago } from "../validation/input.ts";
import { today } from "../utils/dates.ts";

export interface RHEInput {
	empresa: string;
	tipoDoc: TipoDocumento;
	descripcion: string;
	monto: number;
	moneda: "PEN" | "USD";
	medioPago: MedioPago;
	fechaEmision: string;
}

export interface RHEResult {
	empresa: string;
	montoPEN: number;
	retencion8Pct: number;
	netoRecibido: number;
	fechaEmision: string;
	screenshot?: string;
}

const MEDIO_PAGO_SUNAT: Record<string, string> = {
	DEPOSITO: "Depósito en Cuenta",
	GIRO: "Giro",
	TRANSFERENCIA: "Transferencia de Fondos",
	"ORDEN DE PAGO": "Orden de Pago",
	"TARJETA DEBITO": "Tarjeta de Débito",
	"TARJETA CREDITO": "Tarjeta de Crédito emitida en el país por una empresa del Sistema Financiero",
	CHEQUE: "Cheques con cláusula: no negociables - intransferibles - no a la orden o similar",
	EFECTIVO: "Efectivo - por operaciones donde no existe obligación de utilizar Medios de Pago",
};

export async function emitRHE(input: RHEInput, screenshotPath?: string): Promise<RHEResult> {
	// Navigate to RHE form
	await browser.evalJS(
		"ejecuta('MenuInternet.htm?action=iconExecute&code=11.5.1.1.2',false,'Emisión de Recibo por Honorarios Electrónico','#nivel1_11','11.5.1.1.2')",
	);
	await browser.sleep(4000);

	// === STEP 1: Pre-question (Deduccion adicional) ===
	let snap = await browser.snapshot({ interactive: true });
	assertContains(snap, "Iframe", "RHE form did not load");
	const btn1 = findRef(snap, "Continuar", "button");
	await browser.click(btn1);
	await browser.sleep(3000);

	// === STEP 2: Client info ===
	snap = await browser.snapshot({ interactive: true });
	const comboRef = findRef(snap, "combobox", null);
	if (input.tipoDoc !== "RUC") {
		await browser.select(comboRef, input.tipoDoc);
		await browser.sleep(1500);
		snap = await browser.snapshot({ interactive: true });
	}

	// When SIN DOCUMENTO: nombre textbox becomes enabled, numero becomes disabled
	// Find the enabled (non-disabled) textbox after the combobox
	const nombreRef = findFirstEnabled(snap, "textbox");
	await browser.fill(nombreRef, input.empresa);

	const btn2 = findRef(snap, "Continuar", "button");
	await browser.click(btn2);
	await browser.sleep(3000);

	// === STEP 3: Service details + amount ===
	snap = await browser.snapshot({ interactive: true });

	// Descripcion — first enabled textbox in iframe
	const allTextboxes = findAllEnabled(snap, "textbox");
	if (allTextboxes.length < 1) throw new Error("No textboxes found in step 3");

	// allTextboxes[0] = descripcion, [1] = observacion(opt), [2] = fecha, [3] = monto
	await browser.fill(allTextboxes[0], input.descripcion);

	// Medio de pago dropdown — find combobox containing "Medio de Pago" or first unset combobox
	const medioPagoRef = findRef(snap, "Seleccione Medio de Pago", "combobox") || findRef(snap, "combobox", null);
	const medioPagoValue = MEDIO_PAGO_SUNAT[input.medioPago] || input.medioPago;
	await browser.select(medioPagoRef, medioPagoValue);

	// Moneda — only change if USD
	if (input.moneda === "USD") {
		const monedaRef = findRef(snap, "SOL", "combobox");
		await browser.select(monedaRef, "DÓLAR DE NORTE AMÉRICA");
		await browser.sleep(500);
	}

	// Monto — find the textbox with "0.0" value (the enabled one near "Monto Total")
	const montoRef = findRefByValue(snap, "0.0", "textbox");
	await browser.fill(montoRef, String(input.monto));

	if (screenshotPath) {
		await browser.screenshot(screenshotPath);
	}

	// Click Continuar → preview
	const btn3 = findRef(snap, "Continuar", "button");
	await browser.click(btn3);
	await browser.sleep(4000);

	// === STEP 4: Preview & submit ===
	snap = await browser.snapshot({ interactive: true });
	if (screenshotPath) {
		await browser.screenshot(screenshotPath.replace(".png", "-preview.png"));
	}

	// Look for Emitir, Aceptar, or Continuar button
	const submitBtn = findRefSafe(snap, "Emitir", "button") || findRefSafe(snap, "Aceptar", "button") || findRef(snap, "Continuar", "button");
	await browser.click(submitBtn);
	await browser.sleep(4000);

	// Handle potential confirmation dialog
	try {
		snap = await browser.snapshot({ interactive: true });
		const confirmBtn =
			findRefSafe(snap, "Aceptar", "button") || findRefSafe(snap, "OK", "button") || findRefSafe(snap, "Sí", "button");
		if (confirmBtn) {
			await browser.click(confirmBtn);
			await browser.sleep(3000);
		}
	} catch {}

	// Screenshot final result
	if (screenshotPath) {
		await browser.screenshot(screenshotPath.replace(".png", "-result.png"));
	}

	// Clean up and return to dashboard
	await browser.clearBeforeUnload();
	await browser.open("https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*", { headed: true });
	await browser.sleep(2000);

	return {
		empresa: input.empresa,
		montoPEN: input.monto,
		retencion8Pct: Math.round(input.monto * 0.08 * 100) / 100,
		netoRecibido: Math.round(input.monto * 0.92 * 100) / 100,
		fechaEmision: input.fechaEmision || today(),
		screenshot: screenshotPath,
	};
}

function assertContains(snap: string, text: string, msg: string): void {
	if (!snap.includes(text)) throw new Error(msg);
}

function findRef(snap: string, text: string, type: string | null): string {
	const ref = findRefSafe(snap, text, type);
	if (!ref) throw new Error(`Element not found: ${type || "any"} containing "${text}"`);
	return ref;
}

function findRefSafe(snap: string, text: string, type: string | null): string | null {
	for (const line of snap.split("\n")) {
		const matchesType = !type || line.includes(type);
		const matchesText = line.toLowerCase().includes(text.toLowerCase());
		const notDisabled = !line.includes("disabled");
		if (matchesType && matchesText && notDisabled) {
			const m = line.match(/ref=(e\d+)/);
			if (m) return `@${m[1]}`;
		}
	}
	return null;
}

function findFirstEnabled(snap: string, type: string): string {
	for (const line of snap.split("\n")) {
		if (line.includes("Iframe")) continue;
		if (line.includes(type) && !line.includes("disabled") && line.includes("ref=")) {
			const m = line.match(/ref=(e\d+)/);
			if (m) return `@${m[1]}`;
		}
	}
	throw new Error(`No enabled ${type} found`);
}

function findAllEnabled(snap: string, type: string): string[] {
	const refs: string[] = [];
	let inIframe = false;
	for (const line of snap.split("\n")) {
		if (line.includes("Iframe")) inIframe = true;
		if (inIframe && line.includes(type) && !line.includes("disabled")) {
			const m = line.match(/ref=(e\d+)/);
			if (m) refs.push(`@${m[1]}`);
		}
	}
	return refs;
}

function findRefByValue(snap: string, value: string, type: string): string {
	for (const line of snap.split("\n")) {
		if (line.includes(type) && !line.includes("disabled") && line.includes(`: ${value}`)) {
			const m = line.match(/ref=(e\d+)/);
			if (m) return `@${m[1]}`;
		}
	}
	throw new Error(`No ${type} with value "${value}" found`);
}
