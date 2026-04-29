/**
 * SUNAT Consulta Integrada de Comprobantes de Pago Electrónicos.
 *
 * POST /v1/contribuyente/contribuyentes/{ruc}/validarcomprobante
 *
 * Verifies the existence + status of a CPE in SUNAT's records, regardless
 * of who issued it. Useful to:
 *   - Verify your own emitted CPEs (cross-check with cached CDR)
 *   - Verify vendor invoices BEFORE paying them (anti-fraud)
 *
 * Note: requires OAuth client_credentials with scope 'contribuyente'.
 */

import { type OAuthCredentials, callRestApi } from "./oauth.ts";

export type CpeTipoCode = "01" | "03" | "07" | "08" | "20" | "40" | "R1" | "R7" | "09";

export interface ConsultaCpeInput {
	rucConsultante: string; // RUC del que pregunta (usually own RUC)
	rucEmisor: string; // RUC del emisor del comprobante
	tipoComprobante: CpeTipoCode; // 01=Factura, 03=Boleta, 07=NC, 08=ND, 09=Guia, 20=Retencion, 40=Percepcion
	serie: string;
	numero: number;
	fechaEmision: string; // DD/MM/YYYY
	monto?: number; // Optional, must match exactly to 2 decimals
}

export interface ConsultaCpeResponseData {
	estadoCp: string; // "0001" Aceptado, "0002" Anulado, "0003" Autorizada, "0004" No Autorizada
	estadoRuc: string; // "00" Activo, "01" Baja
	condDomiRuc: string; // "00" Habido, "09" No Habido
	observaciones?: string[];
}

export interface ConsultaCpeResponse {
	success: boolean;
	message: string;
	data?: ConsultaCpeResponseData;
	errorCode?: string;
}

export interface FriendlyConsultaResult {
	exists: boolean;
	estadoCp: string;
	estadoCpDesc: string;
	estadoRuc: string;
	estadoRucDesc: string;
	condDomiRuc: string;
	condDomiRucDesc: string;
	observaciones: string[];
	raw: ConsultaCpeResponse;
}

const ESTADO_CP_MAP: Record<string, string> = {
	"0001": "Aceptado",
	"0002": "Anulado",
	"0003": "Autorizada",
	"0004": "No Autorizada",
};

const ESTADO_RUC_MAP: Record<string, string> = {
	"00": "Activo",
	"01": "Baja Provisional",
	"02": "Baja Provisional por Oficio",
	"03": "Suspension Temporal",
	"10": "Baja Definitiva",
	"11": "Baja de Oficio",
	"22": "Inhabilitado",
};

const CONDICION_MAP: Record<string, string> = {
	"00": "Habido",
	"09": "Pendiente",
	"11": "Por verificar",
	"12": "No Hallado",
	"20": "No Habido",
};

function ddmmyyyy(iso: string): string {
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return iso; // assume already DD/MM/YYYY
	return `${m[3]}/${m[2]}/${m[1]}`;
}

export async function validarComprobante(
	input: ConsultaCpeInput,
	creds: OAuthCredentials,
): Promise<FriendlyConsultaResult> {
	const body: Record<string, string> = {
		numRuc: input.rucEmisor,
		codComp: input.tipoComprobante,
		numeroSerie: input.serie,
		numero: String(input.numero),
		fechaEmision: ddmmyyyy(input.fechaEmision),
	};
	if (typeof input.monto === "number") {
		body.monto = input.monto.toFixed(2);
	}

	const resp = await callRestApi<ConsultaCpeResponse>({
		creds,
		method: "POST",
		path: `/contribuyente/contribuyentes/${encodeURIComponent(input.rucConsultante)}/validarcomprobante`,
		body,
	});

	const data = resp.data;
	return {
		exists: !!resp.success && !!data,
		estadoCp: data?.estadoCp || "",
		estadoCpDesc: data?.estadoCp ? ESTADO_CP_MAP[data.estadoCp] || data.estadoCp : "",
		estadoRuc: data?.estadoRuc || "",
		estadoRucDesc: data?.estadoRuc ? ESTADO_RUC_MAP[data.estadoRuc] || data.estadoRuc : "",
		condDomiRuc: data?.condDomiRuc || "",
		condDomiRucDesc: data?.condDomiRuc ? CONDICION_MAP[data.condDomiRuc] || data.condDomiRuc : "",
		observaciones: data?.observaciones || [],
		raw: resp,
	};
}
