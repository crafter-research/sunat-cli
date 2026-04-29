import { existsSync } from "fs";
import { resolveCpeContext } from "../config.ts";
import { findCachedResult, findStalePendings, idempotencyKey, logFailure, logPending, logSuccess } from "../idempotency.ts";
import { signFacturaXml } from "../sign/xades.ts";
import { loadPfx } from "../sign/cert-loader.ts";
import { getStatus, pollStatus, sendBill, sendSummary, SUNAT_ENDPOINTS_FAC } from "../soap/client.ts";
import { bajaFilenameRA, buildBajaUbl } from "../ubl/baja.ts";
import { boletaFilename, boletaRequiresIndividualSubmission, buildBoletaUbl } from "../ubl/boleta.ts";
import { buildFacturaUbl, facturaFilename } from "../ubl/factura.ts";
import { buildResumenUbl, resumenFilename } from "../ubl/resumen.ts";
import { validateBoleta, validateFactura } from "../validation/reglas.ts";
import type {
	BajaSubmitInput,
	BajaSubmitResult,
	BoletaInput,
	CpeDriver,
	CpeResult,
	DoctorReport,
	DriverInfo,
	FacturaInput,
	NotaCreditoInput,
	NotaDebitoInput,
	PreviewResult,
	ResumenStatusResult,
	ResumenSubmitInput,
	ResumenSubmitResult,
} from "./types.ts";

export class SunatDirectDriver implements CpeDriver {
	info(): DriverInfo {
		let mode: "sandbox" | "prod" = "sandbox";
		try {
			const ctx = resolveCpeContext();
			mode = ctx.mode === "prod" ? "prod" : "sandbox";
			return {
				name: "sunat-direct",
				mode,
				version: "0.1.0",
				endpoint: ctx.mode === "prod" ? SUNAT_ENDPOINTS_FAC.prod : SUNAT_ENDPOINTS_FAC.beta,
				requiresJava: false,
				acreditadoOse: false,
			};
		} catch {
			return {
				name: "sunat-direct",
				mode: "sandbox",
				version: "0.1.0",
				endpoint: SUNAT_ENDPOINTS_FAC.beta,
				requiresJava: false,
				acreditadoOse: false,
			};
		}
	}

	async doctor(): Promise<DoctorReport> {
		const checks: DoctorReport["checks"] = [];
		let ctx: ReturnType<typeof resolveCpeContext> | null = null;
		try {
			ctx = resolveCpeContext();
			checks.push({ name: "config_resolved", ok: true, detail: `emisor=${ctx.emisor.ruc} mode=${ctx.mode}` });
		} catch (err) {
			checks.push({ name: "config_resolved", ok: false, detail: err instanceof Error ? err.message : String(err) });
			return { driver: this.info(), ok: false, checks };
		}

		const certExists = existsSync(ctx.certPath);
		checks.push({ name: "cert_file_exists", ok: certExists, detail: ctx.certPath });

		if (certExists) {
			try {
				const cert = loadPfx(ctx.certPath, ctx.certPassword);
				const now = Date.now();
				const validNow = cert.validFrom.getTime() <= now && cert.validTo.getTime() >= now;
				const daysLeft = Math.floor((cert.validTo.getTime() - now) / (1000 * 60 * 60 * 24));
				checks.push({
					name: "cert_loaded",
					ok: validNow,
					detail: `subject=${cert.subject} validUntil=${cert.validTo.toISOString().split("T")[0]} daysLeft=${daysLeft}`,
				});
				if (validNow && daysLeft < 30) {
					checks.push({ name: "cert_expiry_warning", ok: false, detail: `Certificate expires in ${daysLeft} days` });
				}
			} catch (err) {
				checks.push({ name: "cert_loaded", ok: false, detail: err instanceof Error ? err.message : String(err) });
			}
		}

		try {
			const url = ctx.mode === "prod" ? SUNAT_ENDPOINTS_FAC.prod : SUNAT_ENDPOINTS_FAC.beta;
			const wsdl = await fetch(`${url}?wsdl`, { method: "GET" });
			checks.push({ name: "sunat_reachable", ok: wsdl.ok, detail: `${url}?wsdl HTTP ${wsdl.status}` });
		} catch (err) {
			checks.push({ name: "sunat_reachable", ok: false, detail: err instanceof Error ? err.message : String(err) });
		}

		const stale = findStalePendings();
		if (stale.length > 0) {
			checks.push({
				name: "stale_pendings",
				ok: false,
				detail: `${stale.length} pending audit entries older than 1h — process likely crashed mid-submit. Review ~/.sunat/audit/`,
			});
		} else {
			checks.push({ name: "stale_pendings", ok: true, detail: "no stale pending entries" });
		}

		const ok = checks.every((c) => c.ok);
		return { driver: this.info(), ok, checks };
	}

	async previewFactura(input: FacturaInput): Promise<PreviewResult> {
		const ctx = resolveCpeContext();
		const errors = validateFactura(input);
		if (errors.length > 0) {
			return {
				xml: "",
				hash: "",
				wouldSend: false,
				validacion: { ok: false, errors: errors.map((e) => `[${e.code}] ${e.field}: ${e.message}`) },
			};
		}
		const unsigned = buildFacturaUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });
		const hash = `sha256:${await sha256Hex(signed.xml)}`;
		return { xml: signed.xml, hash, wouldSend: true, validacion: { ok: true, errors: [] } };
	}

	async emitFactura(input: FacturaInput): Promise<CpeResult> {
		const ctx = resolveCpeContext();
		const errors = validateFactura(input);
		if (errors.length > 0) {
			throw new Error(`Validation failed: ${errors.map((e) => `[${e.code}] ${e.message}`).join("; ")}`);
		}

		const idemKey = { emisorRuc: ctx.emisor.ruc, tipo: "01" as const, serie: input.serie, numero: input.numero };

		// Idempotency: if already submitted successfully, return cached CDR.
		const cached = findCachedResult(idemKey);
		if (cached) return cached;

		const unsigned = buildFacturaUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });
		const filename = facturaFilename(ctx.emisor.ruc, input.serie, input.numero);
		const hash = `sha256:${await sha256Hex(signed.xml)}`;

		// Two-phase audit: pre-write pending before SOAP call.
		const auditArgs = { serie: input.serie, numero: input.numero, total: input.totales.total };
		logPending(idemKey, "cpe factura emit", auditArgs);

		try {
			const soapResult = await sendBill({
				mode: ctx.mode,
				wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
				wsPassword: ctx.solPassword,
				xml: signed.xml,
				filename,
			});

			const result: CpeResult = {
				id: idempotencyKey(idemKey),
				serie: input.serie,
				numero: input.numero,
				hash,
				status: soapResult.cdr.accepted ? "accepted" : "rejected",
				cdrCode: soapResult.cdr.responseCode,
				cdrDesc: soapResult.cdr.description,
				xml: signed.xml,
				ts: new Date().toISOString(),
			};

			logSuccess(idemKey, "cpe factura emit", auditArgs, result);
			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logFailure(idemKey, "cpe factura emit", auditArgs, msg);
			throw err;
		}
	}

	async previewBoleta(input: BoletaInput): Promise<PreviewResult> {
		const ctx = resolveCpeContext();
		const errors = validateBoleta(input);
		if (errors.length > 0) {
			return {
				xml: "",
				hash: "",
				wouldSend: false,
				validacion: { ok: false, errors: errors.map((e) => `[${e.code}] ${e.field}: ${e.message}`) },
			};
		}
		const unsigned = buildBoletaUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });
		const hash = `sha256:${await sha256Hex(signed.xml)}`;
		return { xml: signed.xml, hash, wouldSend: true, validacion: { ok: true, errors: [] } };
	}

	async emitBoleta(input: BoletaInput): Promise<CpeResult> {
		const ctx = resolveCpeContext();
		const errors = validateBoleta(input);
		if (errors.length > 0) {
			throw new Error(`Validation failed: ${errors.map((e) => `[${e.code}] ${e.message}`).join("; ")}`);
		}

		// Boletas below S/700 must be sent in a daily summary (sendSummary).
		// Above the threshold, they go individually via sendBill — same path as factura.
		if (!boletaRequiresIndividualSubmission(input.totales.total)) {
			throw new Error(
				`Boleta total S/${input.totales.total.toFixed(2)} < S/700: must be sent via daily summary. Use 'sunat cpe boleta queue' + 'sunat cpe resumen send' (coming in next phase). Or set --force-individual to override (not recommended; SUNAT may reject).`,
			);
		}

		const idemKey = { emisorRuc: ctx.emisor.ruc, tipo: "03" as const, serie: input.serie, numero: input.numero };

		const cached = findCachedResult(idemKey);
		if (cached) return cached;

		const unsigned = buildBoletaUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });
		const filename = boletaFilename(ctx.emisor.ruc, input.serie, input.numero);
		const hash = `sha256:${await sha256Hex(signed.xml)}`;

		const auditArgs = { serie: input.serie, numero: input.numero, total: input.totales.total };
		logPending(idemKey, "cpe boleta emit", auditArgs);

		try {
			const soapResult = await sendBill({
				mode: ctx.mode,
				wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
				wsPassword: ctx.solPassword,
				xml: signed.xml,
				filename,
			});

			const result: CpeResult = {
				id: idempotencyKey(idemKey),
				serie: input.serie,
				numero: input.numero,
				hash,
				status: soapResult.cdr.accepted ? "accepted" : "rejected",
				cdrCode: soapResult.cdr.responseCode,
				cdrDesc: soapResult.cdr.description,
				xml: signed.xml,
				ts: new Date().toISOString(),
			};

			logSuccess(idemKey, "cpe boleta emit", auditArgs, result);
			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logFailure(idemKey, "cpe boleta emit", auditArgs, msg);
			throw err;
		}
	}

	async emitNotaCredito(_input: NotaCreditoInput): Promise<CpeResult> {
		throw new Error("sunat-direct: nota de credito not yet implemented. Use --driver mock.");
	}

	async emitNotaDebito(_input: NotaDebitoInput): Promise<CpeResult> {
		throw new Error("sunat-direct: nota de debito not yet implemented. Use --driver mock.");
	}

	async submitResumen(input: ResumenSubmitInput): Promise<ResumenSubmitResult> {
		const ctx = resolveCpeContext();
		if (input.entries.length === 0) {
			throw new Error("Cannot submit empty resumen — at least one boleta entry required");
		}

		const filename = resumenFilename(ctx.emisor.ruc, input.fechaResumen, input.correlativo);
		const idemId = `${ctx.emisor.ruc}-RC-${input.fechaResumen.replace(/-/g, "")}-${input.correlativo}`;
		const idemKey = {
			emisorRuc: ctx.emisor.ruc,
			tipo: "01" as const, // Resumen ID for idempotency lookup; not a CPE tipoDoc
			serie: `RC-${input.fechaResumen.replace(/-/g, "")}`,
			numero: input.correlativo,
		};

		const cached = findCachedResult(idemKey);
		if (cached) {
			return {
				id: idemId,
				ticket: (cached as unknown as { ticket?: string }).ticket || "",
				status: cached.status === "accepted" ? "accepted" : cached.status === "rejected" ? "rejected" : "submitted",
				cdrCode: cached.cdrCode,
				cdrDesc: cached.cdrDesc,
				xml: cached.xml,
				ts: cached.ts,
			};
		}

		const unsigned = buildResumenUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });

		const auditArgs = {
			fechaEmisionBoletas: input.fechaEmisionBoletas,
			fechaResumen: input.fechaResumen,
			correlativo: input.correlativo,
			entryCount: input.entries.length,
		};
		logPending(idemKey, "cpe resumen send", auditArgs);

		try {
			const summaryResp = await sendSummary({
				mode: ctx.mode,
				wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
				wsPassword: ctx.solPassword,
				xml: signed.xml,
				filename,
			});

			const result: ResumenSubmitResult = {
				id: idemId,
				ticket: summaryResp.ticket,
				status: "submitted",
				xml: signed.xml,
				ts: new Date().toISOString(),
			};

			logSuccess(
				idemKey,
				"cpe resumen send",
				auditArgs,
				{
					id: idemId,
					serie: idemKey.serie,
					numero: input.correlativo,
					hash: signed.cert.serialNumber,
					status: "pending",
					cdrCode: undefined,
					cdrDesc: `ticket=${summaryResp.ticket}`,
					xml: signed.xml,
					ts: result.ts,
				} as unknown as never,
			);

			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logFailure(idemKey, "cpe resumen send", auditArgs, msg);
			throw err;
		}
	}

	async getResumenStatus(ticket: string): Promise<ResumenStatusResult> {
		const ctx = resolveCpeContext();
		const outcome = await getStatus({
			mode: ctx.mode,
			wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
			wsPassword: ctx.solPassword,
			ticket,
		});

		if (outcome.state === "processing") {
			return { ticket, state: "processing", statusCode: outcome.statusCode };
		}

		return {
			ticket,
			state: outcome.state,
			statusCode: outcome.statusCode,
			cdrCode: outcome.cdr.responseCode,
			cdrDesc: outcome.cdr.description,
			notes: outcome.cdr.notes,
		};
	}

	async pollResumen(ticket: string, opts?: { timeoutMs?: number; onTick?: (n: number, s: string) => void }): Promise<ResumenStatusResult> {
		const ctx = resolveCpeContext();
		const outcome = await pollStatus({
			mode: ctx.mode,
			wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
			wsPassword: ctx.solPassword,
			ticket,
			timeoutMs: opts?.timeoutMs,
			onTick: opts?.onTick,
		});
		if (outcome.state === "processing") {
			return { ticket, state: "processing", statusCode: outcome.statusCode };
		}
		return {
			ticket,
			state: outcome.state,
			statusCode: outcome.statusCode,
			cdrCode: outcome.cdr.responseCode,
			cdrDesc: outcome.cdr.description,
			notes: outcome.cdr.notes,
		};
	}

	async submitBaja(input: BajaSubmitInput): Promise<BajaSubmitResult> {
		const ctx = resolveCpeContext();
		if (input.entries.length === 0) {
			throw new Error("Cannot submit empty baja — at least one document required");
		}

		const filename = bajaFilenameRA(ctx.emisor.ruc, input.fechaComunicacion, input.correlativo);
		const idemId = `${ctx.emisor.ruc}-RA-${input.fechaComunicacion.replace(/-/g, "")}-${input.correlativo}`;

		const unsigned = buildBajaUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });

		const summaryResp = await sendSummary({
			mode: ctx.mode,
			wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
			wsPassword: ctx.solPassword,
			xml: signed.xml,
			filename,
		});

		return {
			id: idemId,
			ticket: summaryResp.ticket,
			status: "submitted",
			xml: signed.xml,
			ts: new Date().toISOString(),
		};
	}
}

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
