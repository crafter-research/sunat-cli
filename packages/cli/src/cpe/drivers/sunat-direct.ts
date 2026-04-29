import { existsSync } from "fs";
import { resolveCpeContext } from "../config.ts";
import { signFacturaXml } from "../sign/xades.ts";
import { loadPfx } from "../sign/cert-loader.ts";
import { sendBill, SUNAT_ENDPOINTS_FAC } from "../soap/client.ts";
import { buildFacturaUbl, facturaFilename } from "../ubl/factura.ts";
import { validateFactura } from "../validation/reglas.ts";
import type {
	BoletaInput,
	CpeDriver,
	CpeResult,
	DoctorReport,
	DriverInfo,
	FacturaInput,
	NotaCreditoInput,
	NotaDebitoInput,
	PreviewResult,
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

		const unsigned = buildFacturaUbl(input, { emisor: ctx.emisor });
		const signed = signFacturaXml(unsigned, { pfxPath: ctx.certPath, pfxPassword: ctx.certPassword });
		const filename = facturaFilename(ctx.emisor.ruc, input.serie, input.numero);
		const hash = `sha256:${await sha256Hex(signed.xml)}`;

		const result = await sendBill({
			mode: ctx.mode,
			wsUsername: `${ctx.emisor.ruc}${ctx.solUsuario}`,
			wsPassword: ctx.solPassword,
			xml: signed.xml,
			filename,
		});

		return {
			id: filename,
			serie: input.serie,
			numero: input.numero,
			hash,
			status: result.cdr.accepted ? "accepted" : "rejected",
			cdrCode: result.cdr.responseCode,
			cdrDesc: result.cdr.description,
			xml: signed.xml,
			ts: new Date().toISOString(),
		};
	}

	async emitBoleta(_input: BoletaInput): Promise<CpeResult> {
		throw new Error("sunat-direct: boleta not yet implemented (factura only in this milestone). Use --driver mock.");
	}

	async emitNotaCredito(_input: NotaCreditoInput): Promise<CpeResult> {
		throw new Error("sunat-direct: nota de credito not yet implemented. Use --driver mock.");
	}

	async emitNotaDebito(_input: NotaDebitoInput): Promise<CpeResult> {
		throw new Error("sunat-direct: nota de debito not yet implemented. Use --driver mock.");
	}
}

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
