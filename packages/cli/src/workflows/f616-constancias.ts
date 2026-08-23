/**
 * Descarga de constancias de una presentación ya hecha.
 *
 * El botón "Guardar" del visor baja **un PDF con todas las constancias del
 * lote**, no una por una: para 8 declaraciones + 8 boletas devuelve un solo
 * archivo de 16. Iterar con la flecha de siguiente es innecesario.
 */

import { connect } from "../browser/cdp.ts";

const PROBE = `/N[úu]mero de Orden/.test(document.body?document.body.innerText:'')`;

export interface ResultadoConstancias {
	ok: boolean;
	dir: string;
	mensaje?: string;
}

/**
 * Requiere estar en el paso "Constancia" con el visor abierto
 * ("Ver todas las constancias").
 */
export async function descargarConstancias(dir: string): Promise<ResultadoConstancias> {
	const s = await connect({ probe: PROBE });
	try {
		let descargas = 0;
		// El evento llega por el canal crudo, no por evalIn.
		await s.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true });
		await new Promise((r) => setTimeout(r, 800));

		const clicked = await s.evalIn(
			`(function(){var b=[...document.querySelectorAll('button,a')].find(function(e){return e.offsetParent!==null&&/^\\s*Guardar\\s*$/i.test(e.innerText||'')});if(b){b.click();return 1}return 0})()`,
		);
		if (!clicked.val) return { ok: false, dir, mensaje: "No encontré el botón Guardar. ¿Está abierto el visor de constancias?" };

		await new Promise((r) => setTimeout(r, 4000));
		descargas++;
		return { ok: true, dir, mensaje: "El PDF trae todas las constancias del lote." };
	} finally {
		s.close();
	}
}
