export function validateRUC(ruc: string): string {
	const cleaned = ruc.trim();
	if (!/^\d{11}$/.test(cleaned)) {
		throw new Error(`Invalid RUC: must be exactly 11 digits, got "${cleaned}"`);
	}
	if (!cleaned.startsWith("10") && !cleaned.startsWith("20")) {
		throw new Error(`Invalid RUC: must start with 10 (persona) or 20 (empresa), got "${cleaned}"`);
	}
	return cleaned;
}

export function validatePeriodo(periodo: string): string {
	const cleaned = periodo.trim();
	if (!/^\d{4}-\d{2}$/.test(cleaned)) {
		throw new Error(`Invalid periodo: must be YYYY-MM format, got "${cleaned}"`);
	}
	const [year, month] = cleaned.split("-").map(Number);
	if (year < 2020 || year > 2030) {
		throw new Error(`Invalid periodo: year ${year} out of range (2020-2030)`);
	}
	if (month < 1 || month > 12) {
		throw new Error(`Invalid periodo: month ${month} out of range (1-12)`);
	}
	return cleaned;
}

export function validateMonto(monto: number): number {
	if (!Number.isFinite(monto) || monto <= 0) {
		throw new Error(`Invalid monto: must be positive number, got ${monto}`);
	}
	if (monto > 1_000_000) {
		throw new Error(`Invalid monto: ${monto} exceeds reasonable max (1,000,000)`);
	}
	const rounded = Math.round(monto * 100) / 100;
	return rounded;
}

export function rejectControlChars(input: string): string {
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		if (code < 0x20 && code !== 0x0a && code !== 0x0d && code !== 0x09) {
			throw new Error(`Input contains control character at position ${i} (0x${code.toString(16)})`);
		}
	}
	return input;
}

export function validateEmpresa(name: string): string {
	const cleaned = rejectControlChars(name.trim());
	if (cleaned.length === 0) {
		throw new Error("Empresa name cannot be empty");
	}
	if (cleaned.length > 100) {
		throw new Error(`Empresa name too long: ${cleaned.length} chars (max 100)`);
	}
	if (/%[0-9a-f]{2}/i.test(cleaned)) {
		throw new Error("Empresa name contains URL-encoded characters — pass raw text");
	}
	return cleaned;
}

export function sanitizePath(path: string): string {
	const cleaned = rejectControlChars(path.trim());
	if (cleaned.includes("..")) {
		throw new Error("Path contains traversal (..) — rejected");
	}
	if (cleaned.includes("~")) {
		throw new Error("Path contains tilde (~) — use absolute paths");
	}
	return cleaned;
}

const VALID_TIPO_DOC = ["SIN DOCUMENTO", "RUC", "DNI", "CARNET DE EXTRANJERIA", "PASAPORTE", "CED. DIPLOMATICA DE IDENTIDAD"] as const;
export type TipoDocumento = (typeof VALID_TIPO_DOC)[number];

export function validateTipoDoc(tipo: string): TipoDocumento {
	const upper = tipo.trim().toUpperCase();
	const found = VALID_TIPO_DOC.find((v) => v === upper);
	if (!found) {
		throw new Error(`Invalid tipoDoc: "${tipo}". Valid: ${VALID_TIPO_DOC.join(", ")}`);
	}
	return found;
}

const VALID_MONEDA = ["PEN", "USD", "SOL", "DOLAR DE NORTE AMERICA"] as const;
export function validateMoneda(moneda: string): "PEN" | "USD" {
	const upper = moneda.trim().toUpperCase();
	if (upper === "PEN" || upper === "SOL") return "PEN";
	if (upper === "USD" || upper === "DOLAR DE NORTE AMERICA") return "USD";
	throw new Error(`Invalid moneda: "${moneda}". Valid: PEN, USD`);
}

const VALID_MEDIO_PAGO = [
	"DEPOSITO",
	"GIRO",
	"TRANSFERENCIA",
	"ORDEN DE PAGO",
	"TARJETA DEBITO",
	"TARJETA CREDITO",
	"CHEQUE",
	"EFECTIVO",
] as const;
export type MedioPago = (typeof VALID_MEDIO_PAGO)[number];

export function validateMedioPago(medio: string): MedioPago {
	const upper = medio.trim().toUpperCase();
	const found = VALID_MEDIO_PAGO.find((v) => v === upper);
	if (!found) {
		throw new Error(`Invalid medioPago: "${medio}". Valid: ${VALID_MEDIO_PAGO.join(", ")}`);
	}
	return found;
}
