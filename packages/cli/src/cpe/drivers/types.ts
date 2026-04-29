/**
 * CpeDriver — backend abstraction for CPE emission.
 *
 * Multiple drivers (mock, facturador, sunat-direct, nubefact, apisperu)
 * implement this interface so the CLI commands stay backend-agnostic.
 *
 * See ./RESEARCH.md for the full shaping rationale.
 */

export type CpeMode = "sandbox" | "prod";
export type CpeDriverName = "mock" | "facturador" | "sunat-direct" | "nubefact" | "apisperu";

export interface DriverInfo {
	name: CpeDriverName;
	mode: CpeMode;
	version: string;
	endpoint?: string;
	requiresJava?: boolean;
	acreditadoOse?: boolean;
}

export interface DoctorCheck {
	name: string;
	ok: boolean;
	detail?: string;
}

export interface DoctorReport {
	driver: DriverInfo;
	checks: DoctorCheck[];
	ok: boolean;
}

export interface Receptor {
	tipoDoc: "1" | "4" | "6" | "7" | "0";
	numDoc: string;
	rznSocial: string;
	direccion?: string;
}

export interface CpeItem {
	codigo: string;
	descripcion: string;
	cantidad: number;
	unidad: string;
	valorUnitario: number;
	igvPct: number;
}

export interface CpeTotales {
	valorVenta: number;
	igv: number;
	total: number;
}

export interface FacturaInput {
	receptor: Receptor;
	items: CpeItem[];
	totales: CpeTotales;
	moneda: "PEN" | "USD";
	serie: string;
	numero: number;
	fechaEmision: string;
}

export type BoletaInput = FacturaInput;

export interface NotaCreditoInput extends FacturaInput {
	motivo: string;
	tipoNota: string;
	refSerie: string;
	refNumero: number;
}

export type NotaDebitoInput = NotaCreditoInput;

export interface CpeResult {
	id: string;
	serie: string;
	numero: number;
	hash: string;
	status: "submitted" | "accepted" | "rejected" | "pending";
	cdrCode?: string;
	cdrDesc?: string;
	xml?: string;
	ts: string;
}

export interface PreviewResult {
	xml: string;
	hash: string;
	wouldSend: boolean;
	validacion: { ok: boolean; errors: string[] };
}

export interface CpeDriver {
	info(): DriverInfo;
	doctor(): Promise<DoctorReport>;
	previewFactura(input: FacturaInput): Promise<PreviewResult>;
	emitFactura(input: FacturaInput): Promise<CpeResult>;
	emitBoleta(input: BoletaInput): Promise<CpeResult>;
	emitNotaCredito(input: NotaCreditoInput): Promise<CpeResult>;
	emitNotaDebito(input: NotaDebitoInput): Promise<CpeResult>;
}
