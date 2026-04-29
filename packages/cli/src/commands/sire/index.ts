import { Command } from "commander";
import { writeFileSync } from "fs";
import { audit } from "../../data/audit.ts";
import {
	COD_LIBRO,
	type CodLibro,
	aceptarPropuestaRvie,
	consultarTicket,
	descargarArchivo,
	descargarPropuesta,
	descargarRvie,
	listarPeriodos,
	pollTicket,
	sireCredentials,
} from "../../sunat-rest/sire.ts";
import { output, outputError } from "../../utils/output.ts";

type Format = "json" | "table" | "auto";

function getFormat(cmd: Command): Format {
	let parent: Command | null = cmd;
	while (parent) {
		const opts = parent.opts();
		if (opts.output) return opts.output as Format;
		parent = parent.parent;
	}
	return "auto";
}

function resolveSireCreds(): ReturnType<typeof sireCredentials> {
	const clientId = process.env.SUNAT_API_CLIENT_ID;
	const clientSecret = process.env.SUNAT_API_CLIENT_SECRET;
	const ruc = process.env.SUNAT_RUC || process.env.CPE_EMISOR_RUC;
	const solUsuario = process.env.SUNAT_USER || process.env.CPE_SOL_USUARIO;
	const solPassword = process.env.SUNAT_PASSWORD || process.env.CPE_SOL_PASSWORD;
	if (!clientId) throw new Error("SUNAT_API_CLIENT_ID env var missing (from SOL → Credenciales API SUNAT, MIGE RCE y RVIE - SIRE)");
	if (!clientSecret) throw new Error("SUNAT_API_CLIENT_SECRET env var missing");
	if (!ruc) throw new Error("SUNAT_RUC env var missing");
	if (!solUsuario) throw new Error("SUNAT_USER env var missing (SOL usuario, NOT the password)");
	if (!solPassword) throw new Error("SUNAT_PASSWORD env var missing (Clave SOL)");
	return sireCredentials({ clientId, clientSecret, ruc, solUsuario, solPassword });
}

function bookCommand(libroAlias: "ventas" | "compras", codLibro: CodLibro): Command {
	const longName = libroAlias === "ventas" ? "Registro de Ventas e Ingresos (RVIE)" : "Registro de Compras (RCE)";
	const sub = new Command(libroAlias).description(`SIRE ${longName} — codLibro=${codLibro}`);

	sub
		.command("periodos")
		.description("Listar ejercicios y periodos disponibles. T0.")
		.action(async (_, cmd) => {
			const format = getFormat(cmd);
			try {
				const creds = resolveSireCreds();
				const ejercicios = await listarPeriodos(codLibro, creds);
				output(format, { json: { codLibro, ejercicios } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	sub
		.command("propuesta")
		.description("Descargar la propuesta SUNAT del periodo (async — returns ticket). T1.")
		.requiredOption("--periodo <YYYYMM>", "Periodo tributario, e.g. 202404")
		.option("--wait", "Poll ticket until completed/error")
		.option("--timeout <ms>", "Polling timeout (default 300000 = 5min)", "300000")
		.option("--out <path>", "When --wait + completed, download the resulting file to this path")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const creds = resolveSireCreds();
				const numTicket = await descargarPropuesta({ codLibro, perTributario: opts.periodo }, creds);

				if (!opts.wait) {
					audit({ command: `sire ${libroAlias} propuesta`, args: { periodo: opts.periodo }, result: "success", details: { numTicket } });
					output(format, {
						json: {
							numTicket,
							hint: `Poll status with: sunat sire ${libroAlias} ticket --num ${numTicket}`,
						},
					});
					return;
				}

				const result = await pollTicket({
					creds,
					numTicket,
					timeoutMs: Number.parseInt(opts.timeout, 10),
				});

				if (result.state !== "completed") {
					output(format, { json: { numTicket, state: result.state, statusCode: result.statusCode, statusDesc: result.statusDesc } });
					return;
				}

				const archivos = result.archivoReporte || [];
				if (opts.out && archivos[0]) {
					const buf = await descargarArchivo(
						{
							nomArchivoReporte: archivos[0].nomArchivoReporte,
							codTipoArchivoReporte: archivos[0].codTipoArchivoReporte || "0",
							codLibro,
							perTributario: opts.periodo,
						},
						creds,
					);
					writeFileSync(opts.out, buf);
					output(format, {
						json: {
							numTicket,
							state: result.state,
							statusDesc: result.statusDesc,
							file: opts.out,
							bytes: buf.length,
							archivoReporte: archivos[0].nomArchivoReporte,
						},
					});
					return;
				}

				output(format, {
					json: {
						numTicket,
						state: result.state,
						statusDesc: result.statusDesc,
						archivoReporte: archivos,
						hint: archivos[0] ? `Download with: sunat sire ${libroAlias} archivo --nombre ${archivos[0].nomArchivoReporte} --periodo ${opts.periodo} --out path` : undefined,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	sub
		.command("ticket")
		.description("Consultar estado de un ticket SIRE. T0.")
		.requiredOption("--num <ticket>", "Número de ticket")
		.option("--wait", "Poll until completed/error")
		.option("--timeout <ms>", "Polling timeout", "300000")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const creds = resolveSireCreds();
				if (opts.wait) {
					const result = await pollTicket({ creds, numTicket: opts.num, timeoutMs: Number.parseInt(opts.timeout, 10) });
					output(format, { json: { numTicket: opts.num, ...result } });
				} else {
					const status = await consultarTicket(opts.num, creds);
					output(format, { json: status });
				}
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	sub
		.command("archivo")
		.description("Descargar un archivo previamente generado por un ticket Terminado. T0.")
		.requiredOption("--nombre <name>", "nomArchivoReporte from a completed ticket")
		.requiredOption("--periodo <YYYYMM>")
		.requiredOption("--out <path>", "Path to write the file")
		.option("--tipo <code>", "codTipoArchivoReporte (default 0 = TXT)", "0")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const creds = resolveSireCreds();
				const buf = await descargarArchivo(
					{
						nomArchivoReporte: opts.nombre,
						codTipoArchivoReporte: opts.tipo,
						codLibro,
						perTributario: opts.periodo,
					},
					creds,
				);
				writeFileSync(opts.out, buf);
				output(format, { json: { file: opts.out, bytes: buf.length } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	if (libroAlias === "ventas") {
		sub
			.command("aceptar")
			.description("Aceptar la propuesta SUNAT como preliminar (RVIE). T2.")
			.requiredOption("--periodo <YYYYMM>")
			.option("--yes", "Skip T2 confirmation")
			.action(async (opts, cmd) => {
				const format = getFormat(cmd);
				try {
					if (!opts.yes) {
						outputError("T2 — requires --yes. This commits the proposal to SUNAT as your preliminar registro.", format);
						return;
					}
					const creds = resolveSireCreds();
					const result = await aceptarPropuestaRvie(opts.periodo, creds);
					audit({ command: "sire ventas aceptar", args: { periodo: opts.periodo }, result: "success", details: result as unknown as Record<string, unknown> });
					output(format, { json: { ...result, hint: `Poll status with: sunat sire ventas ticket --num ${result.numTicket}` } });
				} catch (err) {
					outputError(err instanceof Error ? err.message : String(err), format);
				}
			});

		sub
			.command("descargar")
			.description("Descargar el RVIE generado del periodo (async). T0.")
			.requiredOption("--periodo <YYYYMM>")
			.option("--wait")
			.option("--timeout <ms>", "Polling timeout", "300000")
			.option("--out <path>")
			.action(async (opts, cmd) => {
				const format = getFormat(cmd);
				try {
					const creds = resolveSireCreds();
					const numTicket = await descargarRvie(opts.periodo, creds);
					if (!opts.wait) {
						output(format, { json: { numTicket, hint: `Poll: sunat sire ventas ticket --num ${numTicket}` } });
						return;
					}
					const result = await pollTicket({ creds, numTicket, timeoutMs: Number.parseInt(opts.timeout, 10) });
					if (result.state === "completed" && opts.out && result.archivoReporte?.[0]) {
						const buf = await descargarArchivo(
							{
								nomArchivoReporte: result.archivoReporte[0].nomArchivoReporte,
								codTipoArchivoReporte: result.archivoReporte[0].codTipoArchivoReporte || "0",
								codLibro,
								perTributario: opts.periodo,
							},
							creds,
						);
						writeFileSync(opts.out, buf);
						output(format, { json: { numTicket, ...result, file: opts.out, bytes: buf.length } });
						return;
					}
					output(format, { json: { numTicket, ...result } });
				} catch (err) {
					outputError(err instanceof Error ? err.message : String(err), format);
				}
			});
	}

	return sub;
}

export function createSireCommand(): Command {
	const sire = new Command("sire").description("SUNAT SIRE — Registro de Ventas (RVIE) y Compras (RCE) electrónicos. T0/T1/T2.");
	sire.addCommand(bookCommand("ventas", COD_LIBRO.rvie));
	sire.addCommand(bookCommand("compras", COD_LIBRO.rce));
	return sire;
}
