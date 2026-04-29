import { createHash, randomUUID } from "crypto";
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

export class MockDriver implements CpeDriver {
	info(): DriverInfo {
		return {
			name: "mock",
			mode: "sandbox",
			version: "0.1.0",
			endpoint: "memory://",
			requiresJava: false,
			acreditadoOse: false,
		};
	}

	async doctor(): Promise<DoctorReport> {
		return {
			driver: this.info(),
			ok: true,
			checks: [
				{ name: "driver_loaded", ok: true, detail: "mock driver in-memory" },
				{ name: "no_network", ok: true, detail: "mock never hits the wire" },
			],
		};
	}

	async previewFactura(input: FacturaInput): Promise<PreviewResult> {
		const xml = this.renderUblStub(input, "01");
		return {
			xml,
			hash: this.hash(xml),
			wouldSend: true,
			validacion: { ok: true, errors: [] },
		};
	}

	async previewBoleta(input: BoletaInput): Promise<PreviewResult> {
		const xml = this.renderUblStub(input, "03");
		return {
			xml,
			hash: this.hash(xml),
			wouldSend: true,
			validacion: { ok: true, errors: [] },
		};
	}

	async emitFactura(input: FacturaInput): Promise<CpeResult> {
		return this.fakeSubmit(input, "01");
	}

	async emitBoleta(input: BoletaInput): Promise<CpeResult> {
		return this.fakeSubmit(input, "03");
	}

	async emitNotaCredito(input: NotaCreditoInput): Promise<CpeResult> {
		return this.fakeSubmit(input, "07");
	}

	async emitNotaDebito(input: NotaDebitoInput): Promise<CpeResult> {
		return this.fakeSubmit(input, "08");
	}

	private fakeSubmit(input: FacturaInput, tipoDoc: string): CpeResult {
		const xml = this.renderUblStub(input, tipoDoc);
		return {
			id: randomUUID(),
			serie: input.serie,
			numero: input.numero,
			hash: this.hash(xml),
			status: "accepted",
			cdrCode: "0000",
			cdrDesc: "Aceptado (mock driver)",
			xml,
			ts: new Date().toISOString(),
		};
	}

	private renderUblStub(input: FacturaInput, tipoDoc: string): string {
		return `<?xml version="1.0" encoding="UTF-8"?>
<!-- mock UBL 2.1 stub. NOT a valid SUNAT document. -->
<Invoice tipoDoc="${tipoDoc}" serie="${input.serie}" numero="${input.numero}" total="${input.totales.total}" />`;
	}

	private hash(xml: string): string {
		return `sha256:${createHash("sha256").update(xml).digest("hex")}`;
	}
}
