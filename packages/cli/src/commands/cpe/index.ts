import { Command } from "commander";
import { audit } from "../../data/audit.ts";
import { getDriver } from "../../cpe/drivers/index.ts";
import type { CpeDriverName } from "../../cpe/drivers/types.ts";
import { parseFacturaInput, parseNotaInput } from "../../cpe/parsers.ts";
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

				audit({ command: "cpe factura emit", args: input as unknown as Record<string, unknown>, result: "dry-run", details: { stage: "pending" } });
				const result = await driver.emitFactura(input);
				audit({ command: "cpe factura emit", args: input as unknown as Record<string, unknown>, result: "success", details: result as unknown as Record<string, unknown> });
				output(format, { json: { success: true, ...result } });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({ command: "cpe factura emit", args: {}, result: "error", details: { error: msg } });
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
		.command("emit")
		.description("Emit a Boleta. T2.")
		.requiredOption("--params <json>")
		.option("--dry-run")
		.option("--yes")
		.action(async (opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input = parseFacturaInput(opts.params);
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

				const result = await driver.emitBoleta(input);
				audit({ command: "cpe boleta emit", args: input as unknown as Record<string, unknown>, result: "success", details: result as unknown as Record<string, unknown> });
				output(format, { json: { success: true, ...result } });
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
		.description("Emit a Nota de Debito. T2. STUB.")
		.requiredOption("--params <json>")
		.option("--yes")
		.action((_, cmd) => notImplemented("nd emit", getFormat(cmd)));

	const guia = cpe.command("guia").description("Guia de Remision (CPE tipo 09) operations.");

	guia
		.command("emit")
		.description("Emit a Guia de Remision. T2. STUB — separate BillService endpoint.")
		.option("--params <json>")
		.option("--yes")
		.action((_, cmd) => notImplemented("guia emit", getFormat(cmd)));

	const resumen = cpe.command("resumen").description("Resumen Diario de Boletas operations.");

	resumen
		.command("send")
		.description("Send daily summary of boletas for a given date. Async via getStatus ticket. T2.")
		.option("--fecha <YYYY-MM-DD>")
		.option("--yes")
		.action((_, cmd) => notImplemented("resumen send", getFormat(cmd)));

	const baja = cpe.command("baja").description("Comunicacion de Baja operations.");

	baja
		.command("send")
		.description("Send Comunicacion de Baja for boletas. T2.")
		.option("--params <json>")
		.option("--yes")
		.action((_, cmd) => notImplemented("baja send", getFormat(cmd)));

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

	return cpe;
}
