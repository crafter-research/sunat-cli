import { type CdpSession, connect } from "../browser/cdp.ts";
import * as browser from "../browser/client.ts";
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

export async function emitRHE(
	input: RHEInput,
	opts: { previewOnly?: boolean; beforeSubmit?: () => void | Promise<void> } = {},
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

	return {
		...preview,
		status: confirmation.serie && confirmation.numero ? "issued" : "submitted-unverified",
		...confirmation,
	};
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
