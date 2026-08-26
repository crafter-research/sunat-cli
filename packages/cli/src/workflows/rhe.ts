import { resolve } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { type CdpSession, connect } from "../browser/cdp.ts";
import * as browser from "../browser/client.ts";
import { writePrivateOutputFile } from "../data/private-storage.ts";
import type { MedioPago, TipoDocumento } from "../validation/input.ts";

export interface RHEInput {
	empresa: string;
	tipoDoc: TipoDocumento;
	descripcion: string;
	monto: number;
	moneda: "PEN" | "USD";
	medioPago: MedioPago;
	fechaEmision: string;
}

export interface RHEPreview {
	status: "ready-to-emit";
	empresa: string;
	monto: number;
	moneda: "PEN" | "USD";
	medioPago: MedioPago;
	retencion: number;
	neto: number;
	fechaEmision: string;
}

export interface RHEResult extends Omit<RHEPreview, "status"> {
	status: "issued" | "submitted-unverified";
	serie?: string;
	numero?: string;
	artifacts?: RHEArtifactsResult;
}

export type RHEArtifactKind = "xml" | "pdf";

export interface RHEArtifactFile {
	path: string;
	bytes: number;
	contentType: string;
}

export interface RHEArtifactsResult {
	status: "downloaded" | "partial" | "unavailable";
	directory: string;
	xml?: RHEArtifactFile;
	pdf?: RHEArtifactFile;
	errors?: Partial<Record<RHEArtifactKind, string>>;
}

interface RHEArtifactResponse {
	ok: boolean;
	status: number;
	contentType: string;
	base64: string;
}

const DOCUMENTO_SUNAT: Record<TipoDocumento, string> = {
	"SIN DOCUMENTO": "-",
	RUC: "6",
	DNI: "1",
	"CARNET DE EXTRANJERIA": "4",
	PASAPORTE: "7",
	"CED. DIPLOMATICA DE IDENTIDAD": "A",
};

const MEDIO_PAGO_SUNAT: Record<MedioPago, string> = {
	DEPOSITO: "001",
	GIRO: "002",
	TRANSFERENCIA: "003",
	"ORDEN DE PAGO": "004",
	"TARJETA DEBITO": "005",
	"TARJETA CREDITO": "006",
	CHEQUE: "007",
	EFECTIVO: "008",
};

export function toRHEPortalDate(iso: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) throw new Error(`Invalid fechaEmision: expected YYYY-MM-DD, got "${iso}"`);
	return `${match[3]}/${match[2]}/${match[1]}`;
}

export function toRHEPreviewDate(iso: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) throw new Error(`Invalid fechaEmision: expected YYYY-MM-DD, got "${iso}"`);
	const months = [
		"Enero",
		"Febrero",
		"Marzo",
		"Abril",
		"Mayo",
		"Junio",
		"Julio",
		"Agosto",
		"Septiembre",
		"Octubre",
		"Noviembre",
		"Diciembre",
	];
	return `${Number(match[3])} de ${months[Number(match[2]) - 1]} de ${match[1]}`;
}

export function buildRHEIdentityParams(input: RHEInput): URLSearchParams {
	return new URLSearchParams({
		accion: "CapturaDatosReciboHonorariosIdentidad",
		formaPago: "CONTADO",
		tipdoc: DOCUMENTO_SUNAT[input.tipoDoc],
		nombrecliente: input.empresa,
		ubigeoUsuario: "-",
		direccionUsuario: "-",
		txtUbi_Codigo: " ",
		txtUbi_departamento: " ",
		txtUbi_provincia: " ",
		txtUbi_distrito: " ",
	});
}

export function buildRHEDetailsParams(input: RHEInput): URLSearchParams {
	const amount = input.monto.toFixed(2);
	return new URLSearchParams({
		accion: "CapturaDatosReciboHonorarios",
		total2: new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.monto),
		retencion2: "0.00",
		indrenta: "A",
		gratuito: "0",
		montoNetoPendientePago: "",
		numCuotasRhe: "",
		indgratuito: "0",
		motivo: input.descripcion,
		observacion: "-",
		fecemi: toRHEPortalDate(input.fechaEmision),
		indrenta1: "A",
		indretencion: "00",
		indretregimen: "0",
		indpago: "01",
		mediopago: MEDIO_PAGO_SUNAT[input.medioPago],
		indpagorecibo: "0",
		moneda: input.moneda,
		cantidad: amount,
		mto_aporte_snp: "0.00",
		mto_aporte_aporteafp: "0.00",
		mto_aporte_comisionafp: "0.00",
		mto_aporte_seguroafp: "0.00",
		indexCuota: "",
		montoCuota: "0.0",
	});
}

export function parsePortalAmount(value: string): number {
	const cleaned = value.replace(/[^\d,.-]/g, "");
	if (!cleaned) return Number.NaN;
	const lastComma = cleaned.lastIndexOf(",");
	const lastDot = cleaned.lastIndexOf(".");
	const decimalIndex = Math.max(lastComma, lastDot);
	const decimalDigits = decimalIndex >= 0 ? cleaned.length - decimalIndex - 1 : 0;
	const normalized =
		decimalIndex >= 0 && decimalDigits > 0 && decimalDigits <= 2
			? `${cleaned.slice(0, decimalIndex).replace(/[.,]/g, "")}.${cleaned.slice(decimalIndex + 1)}`
			: cleaned.replace(/[.,]/g, "");
	return Number(normalized);
}

export function extractRHEConfirmation(text: string): { serie?: string; numero?: string } {
	const match = text.match(/\b(E\d{3})\s*[-–]\s*(\d{1,20})\b/i);
	if (!match) return {};
	return { serie: match[1].toUpperCase(), numero: match[2] };
}

export function buildRHEArtifactParams(kind: RHEArtifactKind): URLSearchParams {
	return new URLSearchParams({ accion: kind === "xml" ? "descargarreciboxml1" : "descargarrecibopdf1" });
}

export function decodeRHEArtifact(kind: RHEArtifactKind, response: RHEArtifactResponse): Buffer {
	if (!response.ok || response.status !== 200) {
		throw new Error(`SUNAT ${kind.toUpperCase()} download returned HTTP ${response.status || "network-error"}`);
	}
	const data = Buffer.from(response.base64, "base64");
	if (data.length === 0) throw new Error(`SUNAT ${kind.toUpperCase()} download returned an empty file`);
	const prefix = data
		.subarray(0, 512)
		.toString("utf8")
		.replace(/^\uFEFF/, "")
		.trimStart();
	if (response.contentType.toLowerCase().includes("text/html") || /^<!doctype html|^<html\b/i.test(prefix)) {
		throw new Error(`SUNAT returned an HTML page instead of the ${kind.toUpperCase()} artifact`);
	}
	if (kind === "pdf" && !data.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
		throw new Error("SUNAT PDF download did not contain a PDF signature");
	}
	if (kind === "xml") {
		const validation = XMLValidator.validate(data.toString("utf8").replace(/^\uFEFF/, ""));
		if (validation !== true) throw new Error("SUNAT XML download did not contain valid XML");
	}
	return data;
}

export async function emitRHE(
	input: RHEInput,
	opts: { previewOnly?: boolean; artifactsDir?: string; beforeSubmit?: () => void | Promise<void> } = {},
): Promise<RHEPreview | RHEResult> {
	if (input.tipoDoc !== "SIN DOCUMENTO") {
		throw new Error(
			"RHE emit currently supports tipoDoc SIN DOCUMENTO only; document validation was not present in the captured flow",
		);
	}

	await browser.evalJS(
		"ejecuta('MenuInternet.htm?action=iconExecute&code=11.5.1.1.2',false,'Emisión de Recibo por Honorarios Electrónico','#nivel1_11','11.5.1.1.2')",
	);
	await browser.sleep(3000);

	await onRHEPage(
		`typeof opcGrabar==='function'&&!!document.querySelector('input[name="inddeduccion"]')`,
		async (session) => {
			const identityParams = buildRHEIdentityParams(input).toString();
			const detailsParams = buildRHEDetailsParams(input).toString();
			await evaluate(
				session,
				`(async function(){var endpoint='/ol-ti-itreciboelectronico/cpelec001Alias';var post=async function(stage,body,expected){var response=await fetch(endpoint,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body});var html=await response.text();if(response.status!==200||!expected.test(html))throw new Error('RHE_HTTP_STAGE:'+stage+':unexpected-response');return html};var first=new URLSearchParams(new FormData(document.forms[0]));first.set('accion','RHEDeduccion1');first.set('deduccion','0');first.set('inddeduccion','0');await post('deduction',first,/name=["']tipdoc/i);await post('identity',new URLSearchParams(${JSON.stringify(identityParams)}),/name=["']motivo/i);var preview=await post('details',new URLSearchParams(${JSON.stringify(detailsParams)}),/Emitir Recibo/i);document.open();document.write(preview);document.close();return 'ready-to-emit'})()`,
			);
		},
	);
	await browser.sleep(1000);

	const preview = await onRHEPage(
		`!![...document.querySelectorAll('input[name="wacepta"]')].find(function(el){return /Emitir Recibo/i.test(el.value)})`,
		async (session) => {
			const currencyLabel = input.moneda === "USD" ? "DÓLAR DE NORTE AMÉRICA" : "SOL";
			const previewDate = toRHEPreviewDate(input.fechaEmision);
			const checksRaw = await evaluate(
				session,
				`(function(){var norm=function(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\\s+/g,' ').trim().toLowerCase()};var raw=document.body&&document.body.innerText||'';var text=norm(raw);var amount=function(label){var cell=[...document.querySelectorAll('td')].find(function(td){return label.test(norm(td.textContent))});return cell&&cell.nextElementSibling&&cell.nextElementSibling.nextElementSibling?cell.nextElementSibling.nextElementSibling.textContent.trim():''};return JSON.stringify({empresa:text.includes(norm(${JSON.stringify(input.empresa)})),descripcion:text.includes(norm(${JSON.stringify(input.descripcion)})),moneda:text.includes(norm(${JSON.stringify(currencyLabel)})),fecha:text.includes(norm(${JSON.stringify(previewDate)})),total:amount(/^total por honorarios$/),retencion:amount(/^retencion .* ir$/),neto:amount(/^total neto recibido$/)});})()`,
			);
			const checks = JSON.parse(String(checksRaw)) as {
				empresa: boolean;
				descripcion: boolean;
				moneda: boolean;
				fecha: boolean;
				total: string;
				retencion: string;
				neto: string;
			};
			if (!checks.empresa || !checks.descripcion || !checks.moneda || !checks.fecha) {
				throw new Error(
					"RHE preview could not be reconciled with the requested client, description, date, and currency",
				);
			}
			const total = parsePortalAmount(checks.total);
			if (!Number.isFinite(total) || Math.abs(total - input.monto) > 0.01) {
				throw new Error("RHE preview total does not match the requested amount");
			}
			const parsedRetencion = parsePortalAmount(checks.retencion);
			const retencion = Number.isFinite(parsedRetencion) ? parsedRetencion : 0;
			const parsedNeto = parsePortalAmount(checks.neto);
			const neto = Number.isFinite(parsedNeto) ? parsedNeto : total - retencion;
			return {
				status: "ready-to-emit" as const,
				empresa: input.empresa,
				monto: input.monto,
				moneda: input.moneda,
				medioPago: input.medioPago,
				retencion,
				neto,
				fechaEmision: input.fechaEmision,
			};
		},
	);

	if (opts.previewOnly) return preview;
	await opts.beforeSubmit?.();

	await onRHEPage(
		`!![...document.querySelectorAll('input[name="wacepta"]')].find(function(el){return /Emitir Recibo/i.test(el.value)})`,
		async (session) => {
			await evaluate(
				session,
				`[...document.querySelectorAll('input[name="wacepta"]')].find(function(el){return /Emitir Recibo/i.test(el.value)}).click();'ok'`,
			);
		},
	);
	await browser.sleep(3000);

	const confirmation = await onRHEPage(`!!document.querySelector('input[name="wpagos"]')`, async (session) => {
		const raw = await evaluate(
			session,
			`(function(){var text=document.body&&document.body.innerText||'';var match=text.match(/\\b(E\\d{3})\\s*[-–]\\s*(\\d{1,20})\\b/i);return JSON.stringify(match?{serie:match[1].toUpperCase(),numero:match[2]}:{});})()`,
		);
		return JSON.parse(String(raw)) as { serie?: string; numero?: string };
	});

	let artifacts: RHEArtifactsResult | undefined;
	if (opts.artifactsDir) {
		try {
			artifacts = await downloadRHEArtifacts(opts.artifactsDir, confirmation, input.fechaEmision);
		} catch (error) {
			const message = error instanceof Error ? error.message : "RHE artifact download failed";
			artifacts = {
				status: "unavailable",
				directory: resolve(opts.artifactsDir),
				errors: { xml: message, pdf: message },
			};
		}
	}

	return {
		...preview,
		status: confirmation.serie && confirmation.numero ? "issued" : "submitted-unverified",
		...confirmation,
		...(artifacts ? { artifacts } : {}),
	};
}

async function downloadRHEArtifacts(
	directory: string,
	confirmation: { serie?: string; numero?: string },
	fechaEmision: string,
): Promise<RHEArtifactsResult> {
	const xmlAction = buildRHEArtifactParams("xml").get("accion");
	const pdfAction = buildRHEArtifactParams("pdf").get("accion");
	const responses = await onRHEPage(
		`!!document.forms.lista4&&!!document.forms.lista5&&/descargarreciboxml1/i.test(document.forms.lista4.innerHTML)&&/descargarrecibopdf1/i.test(document.forms.lista5.innerHTML)`,
		async (session) => {
			const raw = await evaluate(
				session,
				`(async function(){var endpoint='/ol-ti-itreciboelectronico/cpelec001Alias';var download=async function(action){try{var response=await fetch(endpoint,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({accion:action})});var blob=await response.blob();var base64=await new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){var value=String(reader.result||'');resolve(value.slice(value.indexOf(',')+1))};reader.onerror=function(){reject(new Error('read-failed'))};reader.readAsDataURL(blob)});return {ok:response.ok,status:response.status,contentType:response.headers.get('content-type')||'',base64:base64}}catch(error){return {ok:false,status:0,contentType:'',base64:''}}};var xml=await download(${JSON.stringify(xmlAction)});var pdf=await download(${JSON.stringify(pdfAction)});return JSON.stringify({xml:xml,pdf:pdf})})()`,
			);
			return JSON.parse(String(raw)) as Record<RHEArtifactKind, RHEArtifactResponse>;
		},
	);

	const targetDirectory = resolve(directory);
	const stem =
		confirmation.serie && confirmation.numero
			? `RHE-${confirmation.serie}-${confirmation.numero}`
			: `RHE-${fechaEmision}-${Date.now()}`;
	const result: RHEArtifactsResult = { status: "unavailable", directory: targetDirectory };
	const errors: Partial<Record<RHEArtifactKind, string>> = {};
	for (const kind of ["xml", "pdf"] as const) {
		try {
			const data = decodeRHEArtifact(kind, responses[kind]);
			const path = resolve(targetDirectory, `${stem}.${kind}`);
			writePrivateOutputFile(path, data);
			result[kind] = {
				path,
				bytes: data.length,
				contentType: normalizeRHEArtifactContentType(kind, responses[kind].contentType),
			};
		} catch (error) {
			errors[kind] = error instanceof Error ? error.message : `RHE ${kind.toUpperCase()} download failed`;
		}
	}
	const count = Number(Boolean(result.xml)) + Number(Boolean(result.pdf));
	result.status = count === 2 ? "downloaded" : count === 1 ? "partial" : "unavailable";
	if (Object.keys(errors).length > 0) result.errors = errors;
	return result;
}

function normalizeRHEArtifactContentType(kind: RHEArtifactKind, value: string): string {
	const contentType = value.split(";", 1)[0].trim().toLowerCase();
	return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType)
		? contentType
		: kind === "xml"
			? "application/xml"
			: "application/pdf";
}

async function onRHEPage<T>(probe: string, run: (session: CdpSession) => Promise<T>): Promise<T> {
	const session = await connect({ pageUrl: "MenuInternet", origin: "ww1.sunat.gob.pe", probe });
	try {
		return await run(session);
	} finally {
		session.close();
	}
}

async function evaluate(session: CdpSession, expression: string): Promise<unknown> {
	const result = await session.evalIn(expression);
	if (result.err) throw new Error(`RHE portal evaluation failed: ${result.err}`);
	return result.val;
}
