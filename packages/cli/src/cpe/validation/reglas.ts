/**
 * Top SUNAT validation rules for CPE Factura + Boleta Electronica.
 *
 * NOT exhaustive — covers the rules that reject ~95% of malformed inputs
 * before hitting the SUNAT SOAP endpoint. Full SUNAT catalog is ~600 rules.
 */

import type { BoletaInput, CpeItem, CpeTotales, FacturaInput } from "../drivers/types.ts";
import { BOLETA_RECEPTOR_REQUIRED_THRESHOLD } from "../ubl/boleta.ts";

export interface ValidationError {
	code: string;
	field: string;
	message: string;
}

const RUC_FACTOR = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const SERIE_FACTURA = /^F[0-9A-Z]{3}$/;
const SERIE_BOLETA = /^B[0-9A-Z]{3}$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const PLAZO_DIAS = 3;

export function validateRucChecksum(ruc: string): boolean {
	if (!/^\d{11}$/.test(ruc)) return false;
	const digits = ruc.split("").map(Number);
	const sum = RUC_FACTOR.reduce((acc, factor, i) => acc + factor * digits[i], 0);
	const mod = sum % 11;
	let cd: number;
	if (mod === 0) cd = 5;
	else if (mod === 1) cd = 6;
	else cd = 11 - mod;
	return cd === digits[10];
}

export function validateRuc20(ruc: string): boolean {
	return validateRucChecksum(ruc) && ruc.startsWith("20");
}

export function validateFacturaSerie(serie: string): boolean {
	return SERIE_FACTURA.test(serie);
}

export function validateBoletaSerie(serie: string): boolean {
	return SERIE_BOLETA.test(serie);
}

export function validateFechaPlazo(fechaEmision: string, today = new Date()): boolean {
	if (!FECHA_ISO.test(fechaEmision)) return false;
	const emit = new Date(`${fechaEmision}T00:00:00Z`);
	const now = new Date(`${today.toISOString().split("T")[0]}T00:00:00Z`);
	const days = Math.floor((now.getTime() - emit.getTime()) / (1000 * 60 * 60 * 24));
	return days >= 0 && days <= PLAZO_DIAS;
}

export function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

function approxEqual(a: number, b: number, tolerance = 0.02): boolean {
	return Math.abs(a - b) <= tolerance;
}

function validateItemsAndTotals(items: CpeItem[], totales: CpeTotales): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!items || items.length === 0) {
		errors.push({ code: "ITEMS_EMPTY", field: "items", message: "at least one item required" });
		return errors;
	}

	let computedValorVenta = 0;
	let computedIgv = 0;
	for (const [i, item] of items.entries()) {
		if (item.cantidad <= 0) {
			errors.push({ code: "CANTIDAD_POSITIVE", field: `items[${i}].cantidad`, message: "cantidad must be > 0" });
		}
		if (item.valorUnitario < 0) {
			errors.push({
				code: "VALOR_NEGATIVE",
				field: `items[${i}].valorUnitario`,
				message: "valorUnitario must be >= 0",
			});
		}
		if (item.igvPct < 0 || item.igvPct > 18) {
			errors.push({ code: "IGV_PCT_RANGE", field: `items[${i}].igvPct`, message: "igvPct must be 0..18" });
		}
		if (!item.descripcion || item.descripcion.length > 250) {
			errors.push({
				code: "DESCRIPCION_LEN",
				field: `items[${i}].descripcion`,
				message: "descripcion required, max 250 chars",
			});
		}

		const lineSubtotal = item.cantidad * item.valorUnitario;
		const lineIgv = round2(lineSubtotal * (item.igvPct / 100));
		computedValorVenta += lineSubtotal;
		computedIgv += lineIgv;
	}

	computedValorVenta = round2(computedValorVenta);
	computedIgv = round2(computedIgv);
	const computedTotal = round2(computedValorVenta + computedIgv);

	if (!approxEqual(totales.valorVenta, computedValorVenta)) {
		errors.push({
			code: "TOTAL_VALOR_VENTA",
			field: "totales.valorVenta",
			message: `valorVenta ${totales.valorVenta} does not match computed ${computedValorVenta} (tolerance 0.02)`,
		});
	}

	if (!approxEqual(totales.igv, computedIgv)) {
		errors.push({
			code: "TOTAL_IGV",
			field: "totales.igv",
			message: `igv ${totales.igv} does not match computed ${computedIgv} (tolerance 0.02)`,
		});
	}

	if (!approxEqual(totales.total, computedTotal)) {
		errors.push({
			code: "TOTAL_TOTAL",
			field: "totales.total",
			message: `total ${totales.total} does not match computed ${computedTotal} (tolerance 0.02)`,
		});
	}

	return errors;
}

export function validateFactura(input: FacturaInput, today = new Date()): ValidationError[] {
	const errors: ValidationError[] = [];

	if (!validateFacturaSerie(input.serie)) {
		errors.push({ code: "SERIE_FORMAT", field: "serie", message: `Serie '${input.serie}' must match F[A-Z0-9]{3}` });
	}

	if (!Number.isInteger(input.numero) || input.numero < 1 || input.numero > 99_999_999) {
		errors.push({ code: "NUMERO_RANGE", field: "numero", message: "numero must be integer 1..99999999" });
	}

	if (!validateFechaPlazo(input.fechaEmision, today)) {
		errors.push({
			code: "FECHA_PLAZO",
			field: "fechaEmision",
			message: `fechaEmision '${input.fechaEmision}' is outside the ${PLAZO_DIAS}-day SUNAT window or malformed`,
		});
	}

	if (input.receptor.tipoDoc === "6") {
		if (!validateRucChecksum(input.receptor.numDoc)) {
			errors.push({ code: "RUC_RECEPTOR", field: "receptor.numDoc", message: "RUC receptor checksum invalid" });
		}
	} else if (input.receptor.tipoDoc === "1") {
		if (!/^\d{8}$/.test(input.receptor.numDoc)) {
			errors.push({ code: "DNI_RECEPTOR", field: "receptor.numDoc", message: "DNI must be 8 digits" });
		}
	}

	if (!input.receptor.rznSocial || input.receptor.rznSocial.length === 0) {
		errors.push({ code: "RZN_SOCIAL", field: "receptor.rznSocial", message: "rznSocial required" });
	}

	errors.push(...validateItemsAndTotals(input.items, input.totales));

	if (input.moneda !== "PEN" && input.moneda !== "USD") {
		errors.push({ code: "MONEDA", field: "moneda", message: "moneda must be PEN or USD" });
	}

	return errors;
}

/**
 * Boleta-specific validation. Differences vs Factura:
 *  - Serie must start with B (e.g. B001)
 *  - Plazo for individual submission (>=S/700) is also 3 days; below threshold,
 *    boleta goes via daily summary which has 7-day plazo (handled at the
 *    resumen layer, not here)
 *  - Receptor only required when total >= S/700; otherwise "Cliente Varios" allowed
 *  - When total >= S/700 and tipoDoc=1 (DNI), numDoc must be 8 digits (real DNI)
 */
export function validateBoleta(input: BoletaInput, today = new Date()): ValidationError[] {
	const errors: ValidationError[] = [];

	if (!validateBoletaSerie(input.serie)) {
		errors.push({ code: "SERIE_FORMAT", field: "serie", message: `Serie '${input.serie}' must match B[A-Z0-9]{3}` });
	}

	if (!Number.isInteger(input.numero) || input.numero < 1 || input.numero > 99_999_999) {
		errors.push({ code: "NUMERO_RANGE", field: "numero", message: "numero must be integer 1..99999999" });
	}

	if (!validateFechaPlazo(input.fechaEmision, today)) {
		errors.push({
			code: "FECHA_PLAZO",
			field: "fechaEmision",
			message: `fechaEmision '${input.fechaEmision}' is outside the ${PLAZO_DIAS}-day SUNAT window or malformed`,
		});
	}

	const totalAmount = input.totales?.total ?? 0;
	const requiresReceptor = totalAmount >= BOLETA_RECEPTOR_REQUIRED_THRESHOLD;
	const hasReceptor = !!input.receptor && !!input.receptor.numDoc;

	if (requiresReceptor && !hasReceptor) {
		errors.push({
			code: "RECEPTOR_REQUIRED",
			field: "receptor",
			message: `Boleta total >= S/${BOLETA_RECEPTOR_REQUIRED_THRESHOLD} requires receptor with valid numDoc`,
		});
	}

	if (hasReceptor) {
		const r = input.receptor;
		if (r.tipoDoc === "1") {
			if (!/^\d{8}$/.test(r.numDoc)) {
				errors.push({ code: "DNI_RECEPTOR", field: "receptor.numDoc", message: "DNI must be 8 digits" });
			}
		} else if (r.tipoDoc === "6") {
			if (!validateRucChecksum(r.numDoc)) {
				errors.push({ code: "RUC_RECEPTOR", field: "receptor.numDoc", message: "RUC receptor checksum invalid" });
			}
		}
		if (!r.rznSocial || r.rznSocial.length === 0) {
			errors.push({ code: "RZN_SOCIAL", field: "receptor.rznSocial", message: "rznSocial required when receptor present" });
		}
	}

	errors.push(...validateItemsAndTotals(input.items, input.totales));

	if (input.moneda !== "PEN" && input.moneda !== "USD") {
		errors.push({ code: "MONEDA", field: "moneda", message: "moneda must be PEN or USD" });
	}

	return errors;
}
