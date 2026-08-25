/**
 * Declaración del F616 sin llenar el formulario a mano.
 *
 * Lo que hace posible este flujo, y no es obvio: **el F616 no necesita que
 * los RHE existan**. El detalle de ingresos se carga en el propio formulario
 * (Detalle de Ingresos → Nuevo), y ese modal no valida serie ni número contra
 * el SEE, ni tiene límite de retroactividad. El emisor de RHE electrónico sí
 * lo tiene (máximo 2 días), pero no hay que pasar por ahí para declarar.
 *
 * Medido contra el portal el 2026-08-22/23. Ver `recon/sunat-f616-api.md`.
 */

import { type CdpSession, connect, NATIVE_SETTER } from "../browser/cdp.ts";

/** El visor puede tener varios contextos vivos; este los distingue. */
const PROBE = `!!document.getElementById('casilla007')||!!document.getElementById('mytable')`;

export interface IngresoF616 {
	/** Fecha de emisión Y de pago, DD/MM/AAAA. SUNAT exige que el mes coincida con el periodo. */
	fecha: string;
	/** Monto bruto en soles. */
	monto: number;
	/** 4 caracteres, SOLO DÍGITOS. `E001` es rechazada: la E es del nombre de archivo del RHE. */
	serie: string;
	/** 8 caracteres. */
	numero: string;
	/** Con tipo de documento OTROS la razón social queda bloqueada y el nombre va partido. */
	apePat: string;
	apeMat: string;
	nombres: string;
}

export interface DeudaF616 {
	baseImponible: string;
	impuesto: string;
	interes: string;
	importeAPagar: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cierra bootbox/modales abiertos: si queda uno, se come el próximo clic. */
async function limpiarDialogos(s: CdpSession): Promise<void> {
	for (let i = 0; i < 4; i++) {
		const n = await s.evalIn(
			`[...document.querySelectorAll('.bootbox,.modal')].filter(function(m){return m.offsetParent!==null}).length`,
		);
		if (!Number(n.val)) return;
		// Sin tocar "Otro formulario": ese botón resetea el formulario entero.
		await s.evalIn(
			`(function(){var b=[...document.querySelectorAll('.bootbox button,.modal button')].find(function(x){return x.offsetParent!==null&&/^(Aceptar|OK|Cancelar)$/i.test(x.innerText.trim())});if(b)b.click();})()`,
		);
		await sleep(1200);
	}
}

/** Acepta el bootbox visible y devuelve su texto. */
async function aceptarDialogo(s: CdpSession): Promise<string> {
	const txt = await s.evalIn(
		`[...document.querySelectorAll('.bootbox')].map(function(b){return b.innerText.replace(/\\s+/g,' ').trim()}).join(' | ')`,
	);
	await s.evalIn(
		`(function(){var b=[...document.querySelectorAll('.bootbox button')].find(function(x){return /^(Aceptar|S[ií])$/i.test(x.innerText.trim())});if(b)b.click();})()`,
	);
	return String(txt.val || "").slice(0, 160);
}

export async function conectarF616(): Promise<CdpSession> {
	return connect({ probe: PROBE });
}

/**
 * Abre un periodo tributario.
 *
 * `casilla007` es la puerta: escribir el valor no alcanza, hay que disparar
 * `changeCasilla7`, que llama al servidor y recién ahí habilita el resto.
 * Información General además exige teléfono y profesión.
 *
 * IMPORTANTE: el formulario hay que recargarlo entre periodos. Cambiar
 * `casilla007` actualiza el valor pero NO reconstruye las reglas de
 * validación del modal de ingresos, que quedan atadas al periodo anterior.
 */
export async function abrirPeriodo(
	s: CdpSession,
	mmyyyy: string,
	telefono: string,
	profesion = "INGENIERO",
): Promise<boolean> {
	await limpiarDialogos(s);
	await s.evalIn(`(function(){var set=${NATIVE_SETTER};return set('casilla007',${JSON.stringify(mmyyyy)});})()`);
	await sleep(3500);
	await aceptarDialogo(s);
	await sleep(800);

	await s.evalIn(`(function(){var set=${NATIVE_SETTER};set('casilla028',${JSON.stringify(telefono)});
var sel=document.getElementById('casilla025');
if(sel){var o=[...sel.options].find(function(x){return new RegExp(${JSON.stringify(profesion)},'i').test(x.text)});
if(o){Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(sel,o.value);
['input','change','blur'].forEach(function(t){sel.dispatchEvent(new Event(t,{bubbles:true}))});}}
return 'ok';})()`);
	await sleep(1200);

	const disabled = await s.evalIn(
		`document.getElementById('btnSigiente')?document.getElementById('btnSigiente').disabled:true`,
	);
	return !disabled.val;
}

/** El periodo abierto, formato MM/AAAA. */
export async function periodoAbierto(s: CdpSession): Promise<string> {
	const v = await s.evalIn(`document.getElementById('casilla007')?document.getElementById('casilla007').value:''`);
	return String(v.val || "");
}

/**
 * Agrega una fila al detalle de ingresos.
 *
 * El orden importa: el radio de tipo de documento limpia los campos de
 * identidad, así que va antes de llenarlos.
 */
export async function agregarIngreso(
	s: CdpSession,
	ing: IngresoF616,
): Promise<{ ok: boolean; error?: string; filas?: number }> {
	await limpiarDialogos(s);
	await s.evalIn(`document.getElementById('nuevo').click()`);
	await sleep(2500);

	await s.evalIn(`(function(){var el=document.getElementById('rdTipoDocOTROS');if(el&&!el.checked)el.click();})()`);
	await sleep(1200);

	const campos: Array<[string, string]> = [
		["nomPaterno", ing.apePat],
		["nomMaterno", ing.apeMat],
		["textNombres", ing.nombres],
		["textSerie", ing.serie],
		["textNumero", ing.numero],
		["textFecEmision", ing.fecha],
		["textFecPago", ing.fecha],
		["textMonto", String(ing.monto)],
	];
	const r = await s.evalIn(`(function(){var set=${NATIVE_SETTER};var o=[];
${campos.map(([k, v]) => `o.push('${k}='+set('${k}',${JSON.stringify(v)}));`).join("")}
return o.join(' | ');})()`);
	if (String(r.val || "").includes("NO_FIELD")) return { ok: false, error: `Campo ausente: ${r.val}` };
	await sleep(800);

	await s.evalIn(`document.getElementById('btnGrabar').click()`);
	await sleep(2000);

	const errs = await s.evalIn(
		`[...document.querySelectorAll('.modal [id$=Error]')].map(function(e){return e.innerText.trim()}).filter(Boolean).join(' ;; ')`,
	);
	if (errs.val) return { ok: false, error: String(errs.val) };

	await aceptarDialogo(s);
	await sleep(2000);
	await aceptarDialogo(s);
	await sleep(1200);

	const n = await s.evalIn(`document.querySelectorAll('#mytable tbody tr').length`);
	return { ok: true, filas: Number(n.val) };
}

/**
 * Lee el cálculo de la deuda.
 *
 * El cálculo lo dispara el botón Siguiente de la pestaña de ingresos: entrar
 * al tab de Determinación por clic deja las casillas vacías.
 *
 * El interés (553) NO se calcula por fuera: la regla de SUNAT no reproduce
 * con TIM 0.9%/mes desde el vencimiento. Para 11/2025 da S/53 y la fórmula
 * daría S/124. Se lee, no se estima.
 */
export async function leerDeuda(s: CdpSession): Promise<DeudaF616> {
	const yaEsta = await s.evalIn(`document.getElementById('casilla355')?document.getElementById('casilla355').value:''`);
	if (!yaEsta.val) {
		await s.evalIn(
			`(function(){var a=[...document.querySelectorAll('a.nav-link')].find(function(x){return /Detalle de Ingr/i.test(x.innerText||'')});if(a)a.click();})()`,
		);
		await sleep(1800);
		await s.evalIn(`(function(){var b=document.getElementById('btnSigiente');if(b&&!b.disabled)b.click();})()`);
		await sleep(2500);
	}
	const get = async (id: string) =>
		String((await s.evalIn(`document.getElementById('${id}')?document.getElementById('${id}').value:''`)).val || "");
	return {
		baseImponible: await get("casilla307"),
		impuesto: await get("casilla343"),
		interes: await get("casilla553"),
		importeAPagar: await get("casilla355"),
	};
}

/** Manda el formulario a la bandeja de Declaración y Pago. NO presenta ni paga. */
export async function agregarABandeja(s: CdpSession): Promise<{ ok: boolean; importe?: string; mensaje?: string }> {
	await limpiarDialogos(s);
	const deuda = await leerDeuda(s);
	if (!deuda.importeAPagar) return { ok: false, mensaje: "El importe a pagar está vacío. Falta cargar el ingreso." };

	await s.evalIn(`document.getElementById('btn-agregar-bandeja').click()`);
	await sleep(3000);
	const dlg = await aceptarDialogo(s);
	await sleep(2000);
	await aceptarDialogo(s);
	return { ok: true, importe: deuda.importeAPagar, mensaje: dlg };
}

/** Borra las filas del detalle de ingresos del periodo abierto. */
export async function limpiarIngresos(s: CdpSession): Promise<number> {
	for (let i = 0; i < 40; i++) {
		const n = await s.evalIn(`document.querySelectorAll('#mytable tbody tr').length`);
		if (!Number(n.val)) break;
		await s.evalIn(`document.querySelectorAll('#mytable tbody tr')[0].querySelector('a.eliminar').click()`);
		await sleep(1500);
		await aceptarDialogo(s);
		await sleep(1500);
		await aceptarDialogo(s);
		await sleep(1000);
	}
	const n = await s.evalIn(`document.querySelectorAll('#mytable tbody tr').length`);
	return Number(n.val);
}

/** Las filas cargadas, como texto. */
export async function listarIngresos(s: CdpSession): Promise<string[]> {
	const r = await s.evalIn(
		`[...document.querySelectorAll('#mytable tbody tr')].map(function(tr){return [...tr.querySelectorAll('td')].map(function(td){return td.innerText.trim()}).slice(0,10).join(' | ')})`,
	);
	return (r.val as string[]) || [];
}
