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
	tipoDoc: string;
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
	tipoOperacion?: string;
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

export interface ResumenSubmitInput {
	fechaEmisionBoletas: string;
	fechaResumen: string;
	correlativo: number;
	entries: Array<{
		tipoDoc: "03" | "07" | "08";
		serie: string;
		numero: number;
		receptor?: { tipoDoc: string; numDoc: string };
		totales: { valorVenta: number; igv: number; total: number };
		moneda: "PEN" | "USD";
		status?: "1" | "2" | "3";
	}>;
}

export interface ResumenSubmitResult {
	id: string;
	ticket: string;
	status: "submitted" | "accepted" | "rejected" | "processing";
	cdrCode?: string;
	cdrDesc?: string;
	xml?: string;
	ts: string;
}

export interface ResumenStatusResult {
	ticket: string;
	state: "processing" | "completed" | "rejected";
	statusCode: string;
	cdrCode?: string;
	cdrDesc?: string;
	notes?: string[];
}

export interface BajaSubmitInput {
	fechaEmisionDocs: string;
	fechaComunicacion: string;
	correlativo: number;
	entries: Array<{
		tipoDoc: "01" | "03" | "07" | "08";
		serie: string;
		numero: number;
		motivo: string;
	}>;
}

export interface BajaSubmitResult {
	id: string;
	ticket: string;
	status: "submitted" | "accepted" | "rejected" | "processing";
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
	catalogCoverage?: import("../catalogos/types.ts").CatalogCoverageReport;
}

export interface CpeDriver {
	info(): DriverInfo;
	doctor(): Promise<DoctorReport>;
	previewFactura(input: FacturaInput): Promise<PreviewResult>;
	previewBoleta(input: BoletaInput): Promise<PreviewResult>;
	emitFactura(input: FacturaInput): Promise<CpeResult>;
	emitBoleta(input: BoletaInput): Promise<CpeResult>;
	emitNotaCredito(input: NotaCreditoInput): Promise<CpeResult>;
	emitNotaDebito(input: NotaDebitoInput): Promise<CpeResult>;
	submitResumen?(input: ResumenSubmitInput): Promise<ResumenSubmitResult>;
	getResumenStatus?(ticket: string): Promise<ResumenStatusResult>;
	submitBaja?(input: BajaSubmitInput): Promise<BajaSubmitResult>;
}
