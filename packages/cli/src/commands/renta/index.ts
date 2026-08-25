import { Command } from "commander";
import { getCredentials } from "../../data/config.ts";
import {
	type Casilla,
	listarPresentaciones,
	obtenerCasillas,
	obtenerConstancia,
	obtenerDeclaracion,
	obtenerDetalle,
	obtenerFechaHora,
	obtenerFormulario,
	periodoAnual,
	RentaApiError,
} from "../../renta/f709-api.ts";
import { ensureRentaToken, loginRenta } from "../../renta/login.ts";
import { hasFreshToken, readToken } from "../../renta/session.ts";
import { emitNextSteps, type NextStep } from "../../utils/next-steps.ts";
import { output, outputError, outputSuccess } from "../../utils/output.ts";
import { bold, dim, info, muted, ok, warn } from "../../utils/style.ts";

/**
 * F709 — Renta Anual, Persona Natural.
 *
 * Read-only. Every command here is a GET against the taxpayer's own data on
 * e-renta.sunat.gob.pe. Nothing files, amends, or pays: the submission endpoint
 * exists upstream but is deliberately not wired, because filing an annual
 * return is irreversible and its request body has not been captured.
 */

function fail(err: unknown, format: "json" | "table" | "auto"): never {
	if (err instanceof RentaApiError) {
		outputError(err.message, format, { code: err.code, hint: err.hint });
	}
	outputError(err instanceof Error ? err.message : String(err), format);
	process.exit(1);
}

/** Current ejercicio to default to: the annual return covers the PRIOR year. */
function defaultEjercicio(): number {
	return new Date().getFullYear() - 1;
}

function fmtDate(iso: string): string {
	return iso.slice(0, 10);
}

export function createRentaCommand(): Command {
	const renta = new Command("renta").description(
		"Renta Anual Persona Natural (F709) on e-renta. Read-only: consult forms, declarations, filings and constancias. Does NOT file or pay.",
	);

	const fmt = (cmd: Command) => cmd.parent?.parent?.opts().output || "auto";

	renta
		.command("login")
		.description("Authenticate with Clave SOL and cache the e-renta token (1 hour)")
		.option("--force", "Re-authenticate even if the cached token is still fresh")
		.action(async (opts, cmd) => {
			const format = fmt(cmd);
			try {
				const res = await loginRenta(Boolean(opts.force));
				const mins = Math.max(0, Math.round((res.expiresAt - Date.now() / 1000) / 60));
				if (format === "json") {
					output(format, { json: { success: true, ...res, expiresInMinutes: mins } });
				} else {
					outputSuccess(
						res.reused
							? `Session already active for ${bold(res.ruc)} (${res.usuario})`
							: `Signed in as ${bold(res.ruc)} (${res.usuario})`,
						format,
					);
					console.log(dim(`  token valid for ${mins} min · client ${res.versionWeb}`));
				}
			} catch (err) {
				fail(err, format);
			}
		});

	renta
		.command("whoami")
		.description("Show the cached e-renta session status")
		.action((_opts, cmd) => {
			const format = fmt(cmd);
			const cached = readToken();
			const fresh = hasFreshToken();
			const mins = cached ? Math.round((cached.expiresAt - Date.now() / 1000) / 60) : 0;
			let ruc = "";
			try {
				ruc = getCredentials().ruc;
			} catch {
				/* credentials are optional for a status read */
			}

			const json = {
				authenticated: fresh,
				ruc: ruc || null,
				expiresInMinutes: fresh ? mins : 0,
				versionWeb: cached?.versionWeb ?? null,
			};

			const steps: NextStep[] = fresh
				? [
						{
							command: `sunat-cli renta presentaciones -e ${defaultEjercicio()}`,
							description: "declarations already filed",
						},
					]
				: [{ command: "sunat-cli renta login", description: "sign in to e-renta" }];

			if (format === "json") {
				output(format, { json });
				emitNextSteps(steps, format);
				return;
			}
			if (!fresh) {
				console.log(`${warn("○")} No active e-renta session`);
				emitNextSteps(steps, format);
				return;
			}
			console.log(`${ok("●")} Session active${ruc ? ` for ${bold(ruc)}` : ""}`);
			console.log(dim(`  expires in ${mins} min · client ${cached?.versionWeb}`));
			emitNextSteps(steps, format);
		});

	renta
		.command("form")
		.description("Form metadata for an ejercicio: description, filing window, official help links")
		.option("-e, --ejercicio <year>", "Tax year to declare", String(defaultEjercicio()))
		.action(async (opts, cmd) => {
			const format = fmt(cmd);
			try {
				await ensureRentaToken();
				const meta = await obtenerFormulario(opts.ejercicio);
				if (format === "json") {
					output(format, { json: meta });
					return;
				}
				console.log(bold(meta.descripcion));
				console.log(
					`${dim("ejercicio")} ${meta.ejercicio}   ${dim("periodo")} ${periodoAnual(meta.ejercicio)}   ${
						meta.esPresentacion ? ok("filing open") : warn("filing closed")
					}`,
				);
				if (meta.ayudas?.length) {
					console.log();
					console.log(dim("Official help:"));
					for (const a of meta.ayudas) console.log(`  ${a.descripcion}\n    ${muted(a.uri)}`);
				}
			} catch (err) {
				fail(err, format);
			}
		});

	renta
		.command("casillas")
		.description("The form's field schema: every casilla, whether it is required and whether you may edit it")
		.option("-e, --ejercicio <year>", "Tax year", String(defaultEjercicio()))
		.option("--editable", "Only casillas you can fill in")
		.option("--search <text>", "Filter by description")
		.action(async (opts, cmd) => {
			const format = fmt(cmd);
			try {
				await ensureRentaToken();
				let casillas: Casilla[] = await obtenerCasillas(opts.ejercicio);
				if (opts.editable) casillas = casillas.filter((c) => c.indEditable);
				if (opts.search) {
					const q = String(opts.search).toLowerCase();
					casillas = casillas.filter((c) => (c.descripcion || "").toLowerCase().includes(q));
				}

				if (format === "json") {
					output(format, { json: casillas });
					return;
				}

				// The human default is a summary, not 88 rows. Flags widen it.
				const editable = casillas.filter((c) => c.indEditable).length;
				console.log(
					`${bold(String(casillas.length))} casillas   ${dim("·")} ${info(String(editable))} editable   ${dim("·")} ${muted(
						`ejercicio ${opts.ejercicio}`,
					)}`,
				);
				console.log();
				output(format, {
					json: casillas,
					table: {
						headers: ["CASILLA", "DESCRIPTION", "REQ", "EDIT"],
						rows: casillas.map((c) => [
							c.numCas,
							(c.descripcion || "").slice(0, 58),
							c.indObligatorio ? "yes" : dim("no"),
							c.indEditable ? ok("yes") : dim("no"),
						]),
					},
				});
			} catch (err) {
				fail(err, format);
			}
		});

	renta
		.command("declaracion")
		.description("The declaration SUNAT has prefilled for you, with its section totals")
		.option("-e, --ejercicio <year>", "Tax year", String(defaultEjercicio()))
		.option("--full", "Emit the whole document instead of the summary")
		.action(async (opts, cmd) => {
			const format = fmt(cmd);
			try {
				await ensureRentaToken();
				const ruc = getCredentials().ruc;
				const decl = await obtenerDeclaracion(ruc, opts.ejercicio);

				if (format === "json") {
					output(format, { json: opts.full ? decl : { ...decl, declaracion: Object.keys(decl.declaracion) } });
					return;
				}

				console.log(`${bold("Declaración")} ${dim("F709")} ${opts.ejercicio}   ${muted(`RUC ${decl.numRuc}`)}`);
				console.log(dim(`periodo ${decl.perTri} · hash ${decl.valHash.slice(0, 12)}…`));
				console.log();
				const sections: Array<[string, unknown]> = [
					["Generales", decl.declaracion.generales],
					["Sección Informativa", decl.declaracion.seccInformativa],
					["Sección Determinativa", decl.declaracion.seccDeterminativa],
					["Determinación de Deuda", decl.declaracion.determinacionDeuda],
				];
				for (const [name, body] of sections) {
					const n = body && typeof body === "object" ? Object.keys(body as object).length : 0;
					console.log(`  ${n > 0 ? ok("●") : dim("○")} ${name}  ${muted(`${n} fields`)}`);
				}
				console.log();
				console.log(dim(`Full document:  sunat-cli renta declaracion -e ${opts.ejercicio} --full --output json`));
			} catch (err) {
				fail(err, format);
			}
		});

	renta
		.command("presentaciones")
		.description("Declarations already filed for an ejercicio")
		.option("-e, --ejercicio <year>", "Tax year", String(defaultEjercicio()))
		.action(async (opts, cmd) => {
			const format = fmt(cmd);
			try {
				await ensureRentaToken();
				const ruc = getCredentials().ruc;
				const items = await listarPresentaciones(ruc, opts.ejercicio);

				const steps: NextStep[] = items.length
					? [
							{
								command: `sunat-cli renta constancia ${items[0].idPresentacion}`,
								description: "proof of filing for the most recent one",
							},
						]
					: [
							{
								command: `sunat-cli renta form -e ${opts.ejercicio}`,
								description: "check the form is available for this ejercicio",
							},
						];

				if (format === "json") {
					output(format, { json: items });
					emitNextSteps(steps, format);
					return;
				}

				if (items.length === 0) {
					console.log(`${warn("○")} No filings for ejercicio ${bold(opts.ejercicio)}`);
					emitNextSteps(steps, format);
					return;
				}

				console.log(
					`${bold(String(items.length))} filing${items.length > 1 ? "s" : ""} ${muted(`· ejercicio ${opts.ejercicio}`)}`,
				);
				console.log();
				output(format, {
					json: items,
					table: {
						headers: ["ORDEN", "TYPE", "FILED", "PAID", "ID"],
						rows: items.map((p) => [
							String(p.numOrden),
							p.desTipoDeclaracion,
							fmtDate(p.fecDeclaracion.split(" ")[0].split("/").reverse().join("-")),
							p.mtoPag > 0 ? `S/ ${p.mtoPag}` : dim(p.desMedPago || "—"),
							muted(p.idPresentacion),
						]),
					},
				});
				emitNextSteps(steps, format);
			} catch (err) {
				fail(err, format);
			}
		});

	renta
		.command("constancia")
		.description("Proof of filing for one declaration")
		.argument("<idPresentacion>", "Filing id, from 'renta presentaciones'")
		.option("--detalle", "Return the full filed declaration instead of the receipt")
		.action(async (id, opts, cmd) => {
			const format = fmt(cmd);
			try {
				await ensureRentaToken();
				if (opts.detalle) {
					const detail = await obtenerDetalle(id);
					output(format, { json: detail });
					return;
				}
				const res = await obtenerConstancia(id);
				const r = res.resultado as Record<string, string>;
				if (format === "json") {
					output(format, { json: res });
					return;
				}
				console.log(bold("Constancia de presentación"));
				console.log();
				const rows: Array<[string, string | undefined]> = [
					["Operación", r.numeroOperacionSunat],
					["Estado", r.descripcionOperacionSunat],
					["Fecha", r.fechaProcesoPresentacion],
					["RUC", r.numeroRUC],
					["Contribuyente", r.razonSocial],
				];
				for (const [k, v] of rows) if (v) console.log(`  ${dim(k.padEnd(15))} ${v}`);
			} catch (err) {
				fail(err, format);
			}
		});

	renta
		.command("status")
		.description("Whether SUNAT's e-renta service is answering, and its server time")
		.action(async (_opts, cmd) => {
			const format = fmt(cmd);
			try {
				await ensureRentaToken();
				const t = await obtenerFechaHora();
				const steps: NextStep[] = [
					{
						command: `sunat-cli renta presentaciones -e ${defaultEjercicio()}`,
						description: "declarations already filed",
					},
				];
				if (format === "json") {
					output(format, { json: { up: true, ...t } });
					emitNextSteps(steps, format);
					return;
				}
				console.log(`${ok("●")} e-renta responding  ${muted(`server date ${t.fecha}`)}`);
				emitNextSteps(steps, format);
			} catch (err) {
				fail(err, format);
			}
		});

	return renta;
}
