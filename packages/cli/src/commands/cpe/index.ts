import { Command } from "commander";
import { audit } from "../../data/audit.ts";
import { clearQueueForEmisor, enqueueBoleta, listQueueDates, readQueue } from "../../cpe/boleta-queue.ts";
import { buildCatalogCoverageReport, hasCatalogWarnings } from "../../cpe/catalogos/index.ts";
import { resolveCpeContext } from "../../cpe/config.ts";
import { getDriver } from "../../cpe/drivers/index.ts";
import type { CpeDriverName } from "../../cpe/drivers/types.ts";
import { parseFacturaInput, parseNotaInput } from "../../cpe/parsers.ts";
import { loadCpeConfig, saveCpeConfig } from "../../cpe/config.ts";
import { boletaRequiresIndividualSubmission } from "../../cpe/ubl/boleta.ts";
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

function getDriverName(cmd: Command): CpeDriverName | undefined {
	let parent: Command | null = cmd;
	while (parent) {
		const opts = parent.opts();
		if (opts.driver) return opts.driver as CpeDriverName;
		parent = parent.parent;
	}
	return undefined;
}

function notImplemented(verb: string, format: Format): never {
	outputError(
		`'cpe ${verb}' is shaped but not implemented yet. Use --driver mock for end-to-end smoke tests, or see src/cpe/RESEARCH.md.`,
		format,
	);
	throw new Error("unreachable");
}

export function createCpeCommand(): Command {
	const cpe = new Command("cpe").description(
		"Comprobantes de Pago Electronicos (CPE) for empresas con RUC 20. Factura, Boleta, NC, ND, Guia. NOT for personas naturales — use 'sunat rhe'.",
	);

	cpe.option("--driver <name>", "Backend driver: mock|facturador|sunat-direct|nubefact|apisperu (default: mock or $CPE_DRIVER)");

	cpe
		.command("doctor")
		.description("Verify driver health, dependencies, connectivity. T0.")
		.action(async (_, cmd) => {
			const format = getFormat(cmd);
			try {
				const driver = getDriver(getDriverName(cmd));
				const report = await driver.doctor();
				output(format, { json: report });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	cpe
		.command("info")
		.description("Show active driver info (name, mode, version). T0.")
		.action((_, cmd) => {
			const format = getFormat(cmd);
			try {
				const driver = getDriver(getDriverName(cmd));
				output(format, { json: driver.info() });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const factura = cpe.command("factura").description("Factura Electronica (CPE tipo 01) operations.");

	factura
		.command("preview")
		.description("Build + sign + validate locally. Does NOT submit. T0.")
		.requiredOption("--params <json>", "JSON payload (see: sunat schema cpe-factura)")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseFacturaInput(opts.params);
				const driver = getDriver(getDriverName(cmd));
				const result = await driver.previewFactura(input);
				const catalogCoverage = buildCatalogCoverageReport(input);
				if (hasCatalogWarnings(catalogCoverage)) result.catalogCoverage = catalogCoverage;
				audit({ command: "cpe factura preview", args: input as unknown as Record<string, unknown>, result: "dry-run", details: { hash: result.hash } });
				output(format, { json: { dryRun: true, ...result } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	factura
		.command("emit")
		.description("Emit a Factura Electronica. T2 — requires --yes or interactive confirmation.")
		.requiredOption("--params <json>", "JSON payload")
		.option("--dry-run", "Preview only, do not submit")
		.option("--yes", "Skip T2 confirmation prompt")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseFacturaInput(opts.params);
				const driver = getDriver(getDriverName(cmd));

				if (opts.dryRun) {
					const preview = await driver.previewFactura(input);
					const catalogCoverage = buildCatalogCoverageReport(input);
					if (hasCatalogWarnings(catalogCoverage)) preview.catalogCoverage = catalogCoverage;
					audit({ command: "cpe factura emit", args: input as unknown as Record<string, unknown>, result: "dry-run" });
					output(format, { json: { dryRun: true, ...preview } });
					return;
				}

				if (!opts.yes && process.stdout.isTTY) {
					outputError(
						"T2 emission requires --yes flag (interactive confirmation prompt not yet implemented). Use --dry-run first.",
						format,
					);
					return;
				}
				if (!opts.yes && !process.stdout.isTTY) {
					outputError("Non-TTY emission requires explicit --yes flag.", format);
					return;
				}

				// Driver (sunat-direct) handles two-phase audit + idempotency internally.
				// Mock driver doesn't audit; we keep one success entry here for it.
				const result = await driver.emitFactura(input);
				if (driver.info().name === "mock") {
					audit({
						command: "cpe factura emit",
						args: input as unknown as Record<string, unknown>,
						result: "success",
						details: result as unknown as Record<string, unknown>,
					});
				}
				output(format, { json: { success: true, ...result } });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});

	factura
		.command("list")
		.description("List facturas from local audit log. T1.")
		.action((_, cmd) => notImplemented("factura list", getFormat(cmd)));

	factura
		.command("batch")
		.description("Emit N facturas from CSV. T2 per row.")
		.option("--file <path>")
		.option("--max <n>", "Cap rows", "100")
		.option("--yes", "Skip confirmation per row")
		.action((_, cmd) => notImplemented("factura batch", getFormat(cmd)));

	factura
		.command("void")
		.description("Anular a Factura via NC with motivo 01. T3 — requires --intent-token from 'cpe void prepare'.")
		.option("--serie <s>")
		.option("--numero <n>")
		.option("--motivo <text>")
		.option("--intent-token <token>")
		.option("--yes")
		.action((_, cmd) => notImplemented("factura void (T3)", getFormat(cmd)));

	const boleta = cpe.command("boleta").description("Boleta de Venta Electronica (CPE tipo 03) operations.");

	boleta
		.command("preview")
		.description("Build + sign + validate locally. Does NOT submit. T0.")
		.requiredOption("--params <json>", "JSON payload (see: sunat schema cpe-boleta)")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseFacturaInput(opts.params);
				const driver = getDriver(getDriverName(cmd));
				const result = await driver.previewBoleta(input);
				output(format, { json: { dryRun: true, ...result } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	boleta
		.command("emit")
		.description("Emit a Boleta individually (only when total >= S/700). For total<S/700 use 'cpe boleta queue' + 'cpe resumen send'. T2.")
		.requiredOption("--params <json>")
		.option("--dry-run")
		.option("--yes")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseFacturaInput(opts.params);
				const driver = getDriver(getDriverName(cmd));

				if (opts.dryRun) {
					const preview = await driver.previewBoleta(input);
					output(format, { json: { dryRun: true, ...preview } });
					return;
				}
				if (!opts.yes) {
					outputError("T2 emission requires --yes flag.", format);
					return;
				}

				const result = await driver.emitBoleta(input);
				if (driver.info().name === "mock") {
					audit({ command: "cpe boleta emit", args: input as unknown as Record<string, unknown>, result: "success", details: result as unknown as Record<string, unknown> });
				}
				output(format, { json: { success: true, ...result } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	boleta
		.command("queue")
		.description("Queue a boleta for daily-summary submission. Use when total < S/700. T1 (logged, no SUNAT call).")
		.requiredOption("--params <json>")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseFacturaInput(opts.params);
				if (boletaRequiresIndividualSubmission(input.totales.total)) {
					outputError(
						`Boleta total S/${input.totales.total.toFixed(2)} >= S/700: must be sent individually via 'cpe boleta emit', not queued.`,
						format,
					);
					return;
				}
				const ctx = resolveCpeContext();
				const queued = enqueueBoleta(ctx.emisor.ruc, input);
				audit({
					command: "cpe boleta queue",
					args: { serie: input.serie, numero: input.numero, total: input.totales.total },
					result: "success",
					details: { file: queued.file, totalQueued: queued.total },
				});
				output(format, {
					json: {
						queued: true,
						emisorRuc: ctx.emisor.ruc,
						fechaEmision: input.fechaEmision,
						file: queued.file,
						totalQueuedToday: queued.total,
						hint: "When done emitting boletas for the day, run: sunat cpe resumen send --fecha " + input.fechaEmision,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	boleta
		.command("queue:list")
		.description("List queued boletas pending daily-summary. T0.")
		.option("--fecha <YYYY-MM-DD>", "Filter to a specific fechaEmision")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				if (opts.fecha) {
					const entries = readQueue(opts.fecha);
					output(format, { json: { fecha: opts.fecha, total: entries.length, entries } });
					return;
				}
				const dates = listQueueDates();
				const summary = dates.map((d) => ({ fecha: d, total: readQueue(d).length }));
				output(format, { json: { dates: summary } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const nc = cpe.command("nc").description("Nota de Credito (CPE tipo 07) operations.");

	nc
		.command("emit")
		.description("Emit a Nota de Credito. T2.")
		.requiredOption("--params <json>")
		.option("--dry-run")
		.option("--yes")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseNotaInput(opts.params);
				const driver = getDriver(getDriverName(cmd));

				if (opts.dryRun) {
					const preview = await driver.previewFactura(input);
					output(format, { json: { dryRun: true, ...preview } });
					return;
				}
				if (!opts.yes) {
					outputError("T2 emission requires --yes flag.", format);
					return;
				}

				const result = await driver.emitNotaCredito(input);
				audit({ command: "cpe nc emit", args: input as unknown as Record<string, unknown>, result: "success", details: result as unknown as Record<string, unknown> });
				output(format, { json: { success: true, ...result } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const nd = cpe.command("nd").description("Nota de Debito (CPE tipo 08) operations.");

	nd
		.command("emit")
		.description("Emit a Nota de Debito. T2.")
		.requiredOption("--params <json>")
		.option("--dry-run")
		.option("--yes")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseNotaInput(opts.params);
				const driver = getDriver(getDriverName(cmd));

				if (opts.dryRun) {
					const preview = await driver.previewFactura(input);
					output(format, { json: { dryRun: true, ...preview } });
					return;
				}
				if (!opts.yes) {
					outputError("T2 emission requires --yes flag.", format);
					return;
				}

				const result = await driver.emitNotaDebito(input);
				audit({
					command: "cpe nd emit",
					args: input as unknown as Record<string, unknown>,
					result: "success",
					details: result as unknown as Record<string, unknown>,
				});
				output(format, { json: { success: true, ...result } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const gre = cpe.command("gre").description("Guía de Remisión Electrónica (CPE tipo 09) — REST OAuth, NOT SOAP. T0/T2.");
	cpe
		.command("guia")
		.description("Alias for 'cpe gre' — kept for backwards naming.")
		.allowUnknownOption(true)
		.helpOption(false)
		.action(() => {
			console.error("Use 'sunat cpe gre <verb>' instead. 'cpe guia' is an alias placeholder.");
			process.exit(1);
		});

	gre
		.command("emit")
		.description(
			"Sign + zip + base64 + POST a Guía de Remisión via SUNAT GRE REST API. Async — returns ticket. T2.",
		)
		.requiredOption("--params <json>", "JSON payload (run: sunat schema cpe-gre)")
		.option("--dry-run", "Build + sign locally, do NOT submit")
		.option("--yes", "Skip T2 confirmation")
		.option("--wait", "After submit, poll the ticket until completed/rejected")
		.option("--timeout <ms>", "Polling timeout (default 300000 = 5min)", "300000")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const { resolveCpeContext } = await import("../../cpe/config.ts");
				const { signFacturaXml } = await import("../../cpe/sign/xades.ts");
				const { buildGreUbl, greFilename } = await import("../../cpe/ubl/gre.ts");
				const { greCredentials, enviarGre, pollGreTicket } = await import("../../sunat-rest/gre.ts");
				const { resolveOAuthCredentials } = await import("../../cpe/oauth-config.ts").catch(() => ({
					resolveOAuthCredentials: () => {
						throw new Error("oauth-config not found");
					},
				}));

				const ctx = resolveCpeContext();
				const input = JSON.parse(opts.params);
				if (!input.envio || !input.destinatario || !input.items?.length) {
					outputError("GRE requires destinatario, envio, items. Run: sunat schema cpe-gre", format);
					return;
				}
				input.tipoDoc = input.tipoDoc || "09";
				input.serie = input.serie || "T001";

				const unsignedXml = buildGreUbl(input, { emisor: ctx.emisor });
				const { xml: signedXml } = signFacturaXml(unsignedXml, {
					pfxPath: ctx.certPath,
					pfxPassword: ctx.certPassword,
				});
				const filename = greFilename(ctx.emisor.ruc, input.serie, input.numero);

				if (opts.dryRun) {
					output(format, { json: { dryRun: true, filename, signedXmlBytes: signedXml.length } });
					return;
				}

				if (!opts.yes) {
					outputError("T2 emission requires --yes flag.", format);
					return;
				}

				// Need OAuth credentials (client_id/secret + RUC + SOL pwd)
				const clientId = process.env.SUNAT_GRE_CLIENT_ID || process.env.SUNAT_API_CLIENT_ID;
				const clientSecret = process.env.SUNAT_GRE_CLIENT_SECRET || process.env.SUNAT_API_CLIENT_SECRET;
				if (!clientId || !clientSecret) {
					outputError(
						"GRE needs SUNAT_GRE_CLIENT_ID + SUNAT_GRE_CLIENT_SECRET (or SUNAT_API_*) env vars. Get from SOL → Credenciales API SUNAT, URI = 'GRE Emisión de Comprobantes'.",
						format,
					);
					return;
				}
				if (!ctx.solUsuario || !ctx.solPassword) {
					outputError("GRE needs SOL usuario + password (CPE_SOL_USUARIO/PASSWORD env vars).", format);
					return;
				}
				const greCreds = greCredentials({
					clientId,
					clientSecret,
					ruc: ctx.emisor.ruc,
					solUsuario: ctx.solUsuario,
					solPassword: ctx.solPassword,
				});

				const sendResp = await enviarGre({ filename, signedXml }, greCreds);
				const auditDetails: Record<string, unknown> = {
					filename,
					numTicket: sendResp.numTicket,
				};

				if (!opts.wait) {
					output(format, {
						json: {
							submitted: true,
							filename,
							numTicket: sendResp.numTicket,
							hint: `Poll status with: sunat cpe gre status --ticket ${sendResp.numTicket}`,
						},
					});
					audit({ command: "cpe gre emit", args: input as Record<string, unknown>, result: "success", details: auditDetails });
					return;
				}

				const polled = await pollGreTicket({
					creds: greCreds,
					numTicket: sendResp.numTicket,
					timeoutMs: Number.parseInt(opts.timeout, 10),
				});
				audit({
					command: "cpe gre emit",
					args: input as Record<string, unknown>,
					result: polled.state === "completed" ? "success" : polled.state === "rejected" ? "error" : "pending",
					details: { ...auditDetails, ...polled },
				});
				output(format, {
					json: {
						submitted: true,
						filename,
						numTicket: sendResp.numTicket,
						...polled,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	gre
		.command("status")
		.description("Poll status of a previously submitted GRE ticket. T0.")
		.requiredOption("--ticket <id>")
		.option("--wait")
		.option("--timeout <ms>", "Polling timeout", "300000")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const { resolveCpeContext } = await import("../../cpe/config.ts");
				const { greCredentials, consultarGreTicket, pollGreTicket } = await import("../../sunat-rest/gre.ts");
				const ctx = resolveCpeContext();
				const clientId = process.env.SUNAT_GRE_CLIENT_ID || process.env.SUNAT_API_CLIENT_ID;
				const clientSecret = process.env.SUNAT_GRE_CLIENT_SECRET || process.env.SUNAT_API_CLIENT_SECRET;
				if (!clientId || !clientSecret) {
					outputError("Missing SUNAT_GRE_CLIENT_ID/SECRET env vars.", format);
					return;
				}
				const greCreds = greCredentials({
					clientId,
					clientSecret,
					ruc: ctx.emisor.ruc,
					solUsuario: ctx.solUsuario,
					solPassword: ctx.solPassword,
				});

				if (opts.wait) {
					const polled = await pollGreTicket({
						creds: greCreds,
						numTicket: opts.ticket,
						timeoutMs: Number.parseInt(opts.timeout, 10),
					});
					output(format, { json: { ticket: opts.ticket, ...polled } });
					return;
				}

				const status = await consultarGreTicket(opts.ticket, greCreds);
				output(format, { json: status });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const resumen = cpe.command("resumen").description("Resumen Diario de Boletas operations.");

	resumen
		.command("send")
		.description("Send daily summary of queued boletas for a fecha. Async — returns ticket. T2.")
		.requiredOption("--fecha <YYYY-MM-DD>", "fechaEmision of boletas to summarize")
		.option("--correlativo <n>", "Resumen correlativo (1..N within today)", "1")
		.option("--yes", "Skip T2 confirmation prompt")
		.option("--wait", "Poll getStatus until completed/rejected (default: just return ticket)")
		.option("--timeout <ms>", "Polling timeout (default 300000 = 5min)", "300000")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				if (!opts.yes) {
					outputError("T2 emission requires --yes flag.", format);
					return;
				}
				const driver = getDriver(getDriverName(cmd));
				if (!driver.submitResumen) {
					outputError(`Driver "${driver.info().name}" does not support resumen submission.`, format);
					return;
				}

				const ctx = resolveCpeContext();
				const queued = readQueue(opts.fecha).filter((q) => q.emisorRuc === ctx.emisor.ruc);
				if (queued.length === 0) {
					outputError(`No queued boletas for fecha ${opts.fecha} and emisor ${ctx.emisor.ruc}.`, format);
					return;
				}

				const today = new Date().toISOString().split("T")[0];
				const correlativo = Number.parseInt(opts.correlativo, 10);
				const submitInput = {
					fechaEmisionBoletas: opts.fecha,
					fechaResumen: today,
					correlativo,
					entries: queued.map((q) => ({
						tipoDoc: "03" as const,
						serie: q.input.serie,
						numero: q.input.numero,
						receptor: q.input.receptor && q.input.receptor.numDoc
							? { tipoDoc: q.input.receptor.tipoDoc, numDoc: q.input.receptor.numDoc }
							: undefined,
						totales: q.input.totales,
						moneda: q.input.moneda,
					})),
				};

				const submitResult = await driver.submitResumen(submitInput);

				if (!opts.wait) {
					output(format, {
						json: {
							success: true,
							ticket: submitResult.ticket,
							id: submitResult.id,
							submitted: queued.length,
							hint: `Poll status with: sunat cpe resumen status --ticket ${submitResult.ticket}`,
						},
					});
					return;
				}

				if (!driver.getResumenStatus) {
					outputError(`Driver "${driver.info().name}" does not support polling. Use --wait=false.`, format);
					return;
				}

				// Poll until done
				const { pollStatus: doPoll } = await import("../../cpe/soap/client.ts");
				const outcome = await doPoll({
					mode: ctx.mode,
					wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
					wsPassword: ctx.solPassword,
					ticket: submitResult.ticket,
					timeoutMs: Number.parseInt(opts.timeout, 10),
				});

				if (outcome.state === "processing") {
					output(format, { json: { success: false, ticket: submitResult.ticket, state: "still-processing" } });
					return;
				}

				if (outcome.state === "completed") {
					clearQueueForEmisor(opts.fecha, ctx.emisor.ruc);
				}

				output(format, {
					json: {
						success: outcome.state === "completed",
						ticket: submitResult.ticket,
						id: submitResult.id,
						state: outcome.state,
						statusCode: outcome.statusCode,
						cdrCode: outcome.cdr.responseCode,
						cdrDesc: outcome.cdr.description,
						notes: outcome.cdr.notes,
						submitted: queued.length,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	resumen
		.command("status")
		.description("Poll status of a previously submitted resumen ticket. T0.")
		.requiredOption("--ticket <id>")
		.option("--wait", "Poll with backoff until completed/rejected")
		.option("--timeout <ms>", "Polling timeout (default 300000 = 5min)", "300000")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const driver = getDriver(getDriverName(cmd));
				if (!driver.getResumenStatus) {
					outputError(`Driver "${driver.info().name}" does not support resumen status.`, format);
					return;
				}

				if (opts.wait) {
					const ctx = resolveCpeContext();
					const { pollStatus: doPoll } = await import("../../cpe/soap/client.ts");
					const outcome = await doPoll({
						mode: ctx.mode,
						wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
						wsPassword: ctx.solPassword,
						ticket: opts.ticket,
						timeoutMs: Number.parseInt(opts.timeout, 10),
					});
					if (outcome.state === "processing") {
						output(format, { json: { ticket: opts.ticket, state: "still-processing" } });
					} else {
						output(format, {
							json: {
								ticket: opts.ticket,
								state: outcome.state,
								statusCode: outcome.statusCode,
								cdrCode: outcome.cdr.responseCode,
								cdrDesc: outcome.cdr.description,
								notes: outcome.cdr.notes,
							},
						});
					}
					return;
				}

				const status = await driver.getResumenStatus(opts.ticket);
				output(format, { json: status });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const baja = cpe.command("baja").description("Comunicacion de Baja (anular CPE) operations.");

	baja
		.command("send")
		.description("Send Comunicacion de Baja for one or more documents. Async — returns ticket. T2.")
		.requiredOption("--params <json>", "JSON: { fechaEmisionDocs, fechaComunicacion?, correlativo?, entries: [{tipoDoc,serie,numero,motivo}, ...] }")
		.option("--yes", "Skip T2 confirmation prompt")
		.option("--wait", "Poll getStatus until completed/rejected")
		.option("--timeout <ms>", "Polling timeout (default 300000 = 5min)", "300000")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				if (!opts.yes) {
					outputError("T2 emission requires --yes flag.", format);
					return;
				}
				const driver = getDriver(getDriverName(cmd));
				if (!driver.submitBaja) {
					outputError(`Driver "${driver.info().name}" does not support baja submission.`, format);
					return;
				}

				const raw = JSON.parse(opts.params) as {
					fechaEmisionDocs: string;
					fechaComunicacion?: string;
					correlativo?: number;
					entries: Array<{ tipoDoc: "01" | "03" | "07" | "08"; serie: string; numero: number; motivo: string }>;
				};
				if (!raw.fechaEmisionDocs || !raw.entries?.length) {
					outputError("baja requires fechaEmisionDocs and at least one entry", format);
					return;
				}

				const ctx = resolveCpeContext();
				const today = new Date().toISOString().split("T")[0];
				const submitInput = {
					fechaEmisionDocs: raw.fechaEmisionDocs,
					fechaComunicacion: raw.fechaComunicacion || today,
					correlativo: raw.correlativo || 1,
					entries: raw.entries,
				};

				const submitResult = await driver.submitBaja(submitInput);

				if (!opts.wait) {
					output(format, {
						json: {
							success: true,
							ticket: submitResult.ticket,
							id: submitResult.id,
							submitted: raw.entries.length,
							hint: `Poll status with: sunat cpe resumen status --ticket ${submitResult.ticket}`,
						},
					});
					return;
				}

				if (!driver.getResumenStatus) {
					outputError(`Driver "${driver.info().name}" does not support polling.`, format);
					return;
				}

				const { pollStatus: doPoll } = await import("../../cpe/soap/client.ts");
				const outcome = await doPoll({
					mode: ctx.mode,
					wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
					wsPassword: ctx.solPassword,
					ticket: submitResult.ticket,
					timeoutMs: Number.parseInt(opts.timeout, 10),
				});

				if (outcome.state === "processing") {
					output(format, { json: { success: false, ticket: submitResult.ticket, state: "still-processing" } });
					return;
				}

				output(format, {
					json: {
						success: outcome.state === "completed",
						ticket: submitResult.ticket,
						id: submitResult.id,
						state: outcome.state,
						statusCode: outcome.statusCode,
						cdrCode: outcome.cdr.responseCode,
						cdrDesc: outcome.cdr.description,
						notes: outcome.cdr.notes,
						submitted: raw.entries.length,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	cpe
		.command("consulta")
		.description("Validate any CPE against SUNAT (mine or vendor's) via REST OAuth. T0.")
		.requiredOption("--ruc-emisor <ruc>", "RUC of the emisor (issuer)")
		.requiredOption("--tipo <code>", "01=Factura, 03=Boleta, 07=NC, 08=ND, 09=Guia, 20=Retencion, 40=Percepcion")
		.requiredOption("--serie <s>", "e.g. F001")
		.requiredOption("--numero <n>", "Correlativo")
		.requiredOption("--fecha <YYYY-MM-DD>", "Fecha emision (ISO)")
		.option("--monto <n>", "Total amount; if provided, must match SUNAT records exactly to 2 decimals")
		.option("--ruc-consultante <ruc>", "RUC of who is querying (defaults to CPE_EMISOR_RUC env or active profile RUC)")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const { resolveOAuthCredentials } = await import("../../cpe/oauth-config.ts");
				const { validarComprobante } = await import("../../sunat-rest/consulta-cpe.ts");
				const creds = resolveOAuthCredentials();

				let rucConsultante = opts.rucConsultante as string | undefined;
				if (!rucConsultante) {
					try {
						const ctx = resolveCpeContext();
						rucConsultante = ctx.emisor.ruc;
					} catch {
						outputError(
							"--ruc-consultante required (could not resolve from CPE_EMISOR_RUC or active profile)",
							format,
						);
						return;
					}
				}

				const result = await validarComprobante(
					{
						rucConsultante,
						rucEmisor: opts.rucEmisor,
						tipoComprobante: opts.tipo,
						serie: opts.serie,
						numero: Number.parseInt(opts.numero, 10),
						fechaEmision: opts.fecha,
						monto: opts.monto !== undefined ? Number.parseFloat(opts.monto) : undefined,
					},
					creds,
				);
				output(format, { json: result });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const cdr = cpe.command("cdr").description("Constancia de Recepcion (CDR) operations.");

	cdr
		.command("get")
		.description("Retrieve CDR for an emitted CPE. T0. STUB.")
		.option("--serie <s>")
		.option("--numero <n>")
		.action((_, cmd) => notImplemented("cdr get", getFormat(cmd)));

	cpe
		.command("void")
		.description("T3 prepare — generate intent token (10 min TTL) for voiding a CPE. STUB.")
		.argument("[verb]", "prepare")
		.option("--serie <s>")
		.option("--numero <n>")
		.action((_, _opts, cmd) => notImplemented("void prepare (T3 token)", getFormat(cmd)));

	cpe
		.command("driver")
		.description("Manage active driver. T1.")
		.argument("[verb]", "set | list")
		.argument("[name]", "Driver name")
		.action((_, _opts, cmd) => notImplemented("driver set/list", getFormat(cmd)));

	const profile = cpe.command("profile").description("Manage CPE emisor profiles for sunat-direct. T1.");

	profile
		.command("set")
		.description("Save an emisor profile to ~/.sunat/cpe.json")
		.requiredOption("--name <name>", "Profile name (e.g. 'default', 'beta', 'prod')")
		.requiredOption("--ruc <ruc>", "Emisor RUC 20")
		.requiredOption("--razon-social <text>", "Razon social")
		.option("--nombre-comercial <text>")
		.option("--ubigeo <code>", "INEI ubigeo, e.g. 150101")
		.option("--direccion <text>")
		.option("--mode <beta|prod>", "SUNAT environment", "beta")
		.option("--cert-path <path>", "Absolute path to PFX file")
		.option("--sol-usuario <user>", "SOL usuario (no password — use env)")
		.option("--default", "Set as default profile")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const config = loadCpeConfig();
				config.profiles[opts.name] = {
					emisor: {
						ruc: opts.ruc,
						razonSocial: opts.razonSocial,
						nombreComercial: opts.nombreComercial,
						ubigeo: opts.ubigeo,
						direccion: opts.direccion,
						codigoPais: "PE",
					},
					mode: opts.mode === "prod" ? "prod" : "beta",
					driver: "sunat-direct",
					certPath: opts.certPath,
					solUsuario: opts.solUsuario,
				};
				if (opts.default) config.defaultProfile = opts.name;
				saveCpeConfig(config);
				output(format, { json: { ok: true, profile: opts.name, isDefault: !!opts.default } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	profile
		.command("list")
		.description("List configured profiles")
		.action((_, cmd) => {
			const format = getFormat(cmd);
			try {
				const config = loadCpeConfig();
				output(format, { json: { defaultProfile: config.defaultProfile || null, profiles: config.profiles } });
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return cpe;
}
