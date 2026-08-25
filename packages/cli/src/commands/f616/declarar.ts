import { Command } from "commander";
import { audit } from "../../data/audit.ts";
import { type OutputFormat, output, outputError } from "../../utils/output.ts";
import { descargarConstancias } from "../../workflows/f616-constancias.ts";
import {
	abrirPeriodo,
	agregarABandeja,
	agregarIngreso,
	conectarF616,
	type IngresoF616,
	leerDeuda,
	limpiarIngresos,
	listarIngresos,
	periodoAbierto,
} from "../../workflows/f616-declare.ts";

function getFormat(cmd: Command): OutputFormat {
	let p: Command | null = cmd;
	while (p) {
		const o = p.opts();
		if (o.output) return o.output as OutputFormat;
		p = p.parent;
	}
	return "auto";
}

function aMMAAAA(periodo: string): string {
	const m = periodo.match(/^(\d{4})-(\d{2})$/);
	if (!m) throw new Error(`Periodo inválido: "${periodo}". Formato: YYYY-MM.`);
	return `${m[2]}/${m[1]}`;
}

/**
 * Subcomandos que manejan el formulario web del F616 por CDP.
 *
 * A diferencia de `f616 periodo` (lectura por API), esto escribe en el
 * formulario abierto en el navegador. Nada de esto presenta ni paga.
 */
export function createDeclararCommand(): Command {
	const cmd = new Command("declarar").description(
		"Carga el detalle de ingresos en el formulario abierto. No presenta ni paga. T2.",
	);

	cmd
		.command("estado")
		.description("Periodo abierto, filas cargadas y cálculo de la deuda")
		.action(async (_o, c) => {
			const format = getFormat(c);
			let s: Awaited<ReturnType<typeof conectarF616>> | undefined;
			try {
				s = await conectarF616();
				output(format, {
					json: { periodo: await periodoAbierto(s), filas: await listarIngresos(s), ...(await leerDeuda(s)) },
				});
			} catch (e) {
				outputError(e instanceof Error ? e.message : String(e), format);
			} finally {
				s?.close();
			}
		});

	cmd
		.command("periodo <YYYY-MM>")
		.description("Abre un periodo. Recarga el formulario antes de cambiar de periodo.")
		.requiredOption("--telefono <n>", "Teléfono para Información General")
		.requiredOption("--profesion <p>", "Profesión del catálogo")
		.action(async (periodo, opts, c) => {
			const format = getFormat(c);
			let s: Awaited<ReturnType<typeof conectarF616>> | undefined;
			try {
				s = await conectarF616();
				const ok = await abrirPeriodo(s, aMMAAAA(periodo), opts.telefono, opts.profesion);
				output(format, {
					json: {
						periodo: await periodoAbierto(s),
						habilitado: ok,
						...(ok ? {} : { aviso: "El formulario no se habilitó. Revisa si SUNAT mostró algún aviso." }),
					},
				});
			} catch (e) {
				outputError(e instanceof Error ? e.message : String(e), format);
			} finally {
				s?.close();
			}
		});

	cmd
		.command("ingreso")
		.description("Agrega una fila al detalle de ingresos")
		.requiredOption("--fecha <DD/MM/AAAA>", "Emisión y pago; el mes debe coincidir con el periodo")
		.requiredOption("--monto <n>", "Monto bruto en soles")
		.requiredOption("--cliente <nombre>", "Nombre del cliente")
		.option("--serie <s>", "4 dígitos, sin letras", "0001")
		.option("--numero <n>", "8 caracteres", "00000001")
		.option("--dry-run", "Muestra lo que se cargaría sin tocar el formulario")
		.action(async (opts, c) => {
			const format = getFormat(c);
			const partes = String(opts.cliente).trim().split(/\s+/);
			const ing: IngresoF616 = {
				fecha: opts.fecha,
				monto: Number(opts.monto),
				serie: opts.serie,
				numero: opts.numero,
				apePat: partes[0] || opts.cliente,
				apeMat: partes[1] || "",
				nombres: opts.cliente,
			};
			if (opts.dryRun) {
				output(format, { json: { dryRun: true, ...ing, status: "would-add" } });
				return;
			}

			let s: Awaited<ReturnType<typeof conectarF616>> | undefined;
			try {
				s = await conectarF616();
				const abierto = await periodoAbierto(s);
				const mesFecha = String(opts.fecha).slice(3);
				if (abierto && abierto !== mesFecha) {
					outputError(
						`El formulario tiene ${abierto} y la fecha es de ${mesFecha}. SUNAT exige que coincidan.`,
						format,
					);
					return;
				}
				const r = await agregarIngreso(s, ing);
				audit({ command: "f616 declarar ingreso", args: { ...ing }, result: r.ok ? "success" : "error", details: r });
				if (!r.ok) {
					outputError(r.error || "SUNAT rechazó la fila.", format);
					return;
				}
				output(format, { json: { success: true, filas: r.filas, ...(await leerDeuda(s)) } });
			} catch (e) {
				outputError(e instanceof Error ? e.message : String(e), format);
			} finally {
				s?.close();
			}
		});

	cmd
		.command("bandeja")
		.description("Manda el formulario a la bandeja de Declaración y Pago")
		.action(async (_o, c) => {
			const format = getFormat(c);
			let s: Awaited<ReturnType<typeof conectarF616>> | undefined;
			try {
				s = await conectarF616();
				const r = await agregarABandeja(s);
				audit({ command: "f616 declarar bandeja", args: {}, result: r.ok ? "success" : "error", details: r });
				if (!r.ok) {
					outputError(r.mensaje || "No se pudo agregar a la bandeja.", format);
					return;
				}
				output(format, {
					json: { success: true, importe: r.importe, nota: "Presenta y paga tú desde Presente/Pague." },
				});
			} catch (e) {
				outputError(e instanceof Error ? e.message : String(e), format);
			} finally {
				s?.close();
			}
		});

	cmd
		.command("limpiar")
		.description("Borra las filas del detalle de ingresos del periodo abierto")
		.action(async (_o, c) => {
			const format = getFormat(c);
			let s: Awaited<ReturnType<typeof conectarF616>> | undefined;
			try {
				s = await conectarF616();
				output(format, { json: { filasRestantes: await limpiarIngresos(s) } });
			} catch (e) {
				outputError(e instanceof Error ? e.message : String(e), format);
			} finally {
				s?.close();
			}
		});

	cmd
		.command("constancias")
		.description("Descarga el PDF con las constancias del lote presentado")
		.option("--dir <ruta>", "Directorio destino", `${process.env.HOME}/Downloads/constancias-sunat`)
		.action(async (opts, c) => {
			const format = getFormat(c);
			try {
				const r = await descargarConstancias(opts.dir);
				if (!r.ok) {
					outputError(r.mensaje || "No se pudo descargar.", format);
					return;
				}
				output(format, { json: { success: true, dir: r.dir, nota: r.mensaje } });
			} catch (e) {
				outputError(e instanceof Error ? e.message : String(e), format);
			}
		});

	return cmd;
}
