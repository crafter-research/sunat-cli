/**
 * RUC consulta puntual via SUNAT portal (e-consultaruc.sunat.gob.pe).
 *
 * Direct HTTP POSTs return 404 because the portal added a `numRnd` token
 * + reCAPTCHA in 2024. Workaround: drive a real Chrome via agent-browser,
 * fill the form, parse the rendered detail page.
 *
 * For BATCH lookups always prefer `sunat padron ruc/batch` (offline,
 * instantaneous after sync). This module is for ad-hoc single-RUC checks
 * when you don't want to download the 370MB padrón.
 */

import * as browser from "../browser/client.ts";

const PORTAL_URL = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp";

export interface RucPortalEntry {
	ruc: string;
	razonSocial: string;
	estado?: string; // "ACTIVO", "BAJA DE OFICIO", etc
	condicion?: string; // "HABIDO", "NO HABIDO", "NO HALLADO", etc
	tipoContribuyente?: string;
	direccion?: string;
	departamento?: string;
	provincia?: string;
	distrito?: string;
	source: "sunat-portal";
	fetchedAt: string;
}

/**
 * Pure parser for a SUNAT RUC detail page snapshot.
 *
 * The portal renders a table with rows like:
 *   "Número de RUC: 20131312955 - SUPERINTENDENCIA NACIONAL ..."
 *   "Tipo Contribuyente: ..."
 *   "Estado del Contribuyente: ACTIVO"
 *   "Condición del Contribuyente: HABIDO"
 *   "Domicilio Fiscal: AV. ... LIMA - LIMA - LIMA"
 *
 * agent-browser snapshot strips formatting but preserves these
 * "Label: Value" pairs. We extract them with a tolerant regex.
 */
export function parseRucSnapshot(snapshot: string, ruc: string): RucPortalEntry | null {
	// Header line: "Número de RUC: {ruc} - {razon social}"
	const headerMatch = snapshot.match(/N[uú]mero de RUC[:\s]*(\d{11})\s*[-–]?\s*([^\n]+)/i);
	if (!headerMatch || headerMatch[1] !== ruc) return null;

	const razonSocial = headerMatch[2].trim();

	const labelValue = (label: RegExp): string | undefined => {
		const m = snapshot.match(new RegExp(`${label.source}[:\\s]*([^\\n]+)`, "i"));
		return m ? m[1].trim() : undefined;
	};

	const estado = labelValue(/Estado del Contribuyente/);
	const condicion = labelValue(/Condici[óo]n del Contribuyente/);
	const tipoContribuyente = labelValue(/Tipo (?:de )?Contribuyente/);
	const direccion = labelValue(/Domicilio Fiscal/);

	let departamento: string | undefined;
	let provincia: string | undefined;
	let distrito: string | undefined;
	if (direccion) {
		// SUNAT format: "AV CALLE 123 DISTRITO - PROVINCIA - DEPARTAMENTO"
		// where the last segment before " - X - Y" is the address tail with the
		// distrito appended. We pull the last 3 hyphen-segments and then
		// tokenize the leftmost of those to extract the distrito.
		const parts = direccion.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
		if (parts.length >= 3) {
			departamento = parts[parts.length - 1];
			provincia = parts[parts.length - 2];
			const tail = parts[parts.length - 3];
			// distrito is the last whitespace-separated token in the tail
			const tokens = tail.split(/\s+/);
			distrito = tokens[tokens.length - 1];
		}
	}

	return {
		ruc,
		razonSocial,
		estado,
		condicion,
		tipoContribuyente,
		direccion,
		departamento,
		provincia,
		distrito,
		source: "sunat-portal",
		fetchedAt: new Date().toISOString(),
	};
}

/**
 * Navigate the portal, fill the RUC field, click consultar, parse the result.
 *
 * Uses headless agent-browser. Slow (~5-10s per RUC). For batch use, fall
 * back to local padrón instead.
 */
export async function consultarRucPortal(ruc: string): Promise<RucPortalEntry | null> {
	if (!/^\d{11}$/.test(ruc)) {
		throw new Error(`Invalid RUC: '${ruc}'. Must be exactly 11 digits.`);
	}

	await browser.open(PORTAL_URL, { headed: false });
	await browser.sleep(2000);

	const formSnap = await browser.snapshot({ interactive: true });
	const rucRef = extractRef(formSnap, "txtRuc") || extractRef(formSnap, "RUC");
	const submitRef = extractRef(formSnap, "Buscar") || extractRef(formSnap, "btnAceptar");

	if (rucRef) await browser.fill(rucRef, ruc);
	else {
		// Last-resort: try evaluating the form fields directly
		await browser.evalJS(`document.getElementById('txtRuc').value = '${ruc}';`);
	}

	if (submitRef) await browser.click(submitRef);
	else {
		await browser.evalJS("document.forms.mainForm && document.forms.mainForm.submit();");
	}

	await browser.sleep(2500);
	const detail = await browser.snapshot();
	return parseRucSnapshot(detail, ruc);
}

/**
 * Best-effort ref extraction from agent-browser interactive snapshot.
 * The interactive output formats refs as `[ref=e1]` next to interactive elements.
 */
function extractRef(snapshot: string, marker: string): string | null {
	const rx = new RegExp(`${marker}[\\s\\S]{0,80}?\\[ref=([a-z]\\d+)\\]`, "i");
	const m = snapshot.match(rx);
	return m ? m[1] : null;
}
