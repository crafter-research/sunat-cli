import type { FacturaInput, NotaCreditoInput } from "./drivers/types.ts";

function todayIso(): string {
	return new Date().toISOString().split("T")[0];
}

export function parseFacturaInput(payload: string): FacturaInput {
	const raw = JSON.parse(payload) as Record<string, unknown>;
	if (!raw.receptor || !raw.items || !raw.totales) {
		throw new Error("Missing required fields. Run: sunat schema cpe-factura");
	}
	return {
		receptor: raw.receptor as FacturaInput["receptor"],
		items: raw.items as FacturaInput["items"],
		totales: raw.totales as FacturaInput["totales"],
		moneda: ((raw.moneda as string) || "PEN") as FacturaInput["moneda"],
		serie: (raw.serie as string) || "F001",
		numero: (raw.numero as number) || 1,
		fechaEmision: (raw.fechaEmision as string) || todayIso(),
		tipoOperacion: (raw.tipoOperacion as string) || "0101",
	};
}

export function parseNotaInput(payload: string): NotaCreditoInput {
	const base = parseFacturaInput(payload);
	const raw = JSON.parse(payload) as Record<string, unknown>;
	if (!raw.refSerie || !raw.refNumero || !raw.tipoNota) {
		throw new Error("Nota requires refSerie, refNumero, tipoNota. Run: sunat schema cpe-nota-credito");
	}
	return {
		...base,
		motivo: (raw.motivo as string) || "Anulacion",
		tipoNota: raw.tipoNota as string,
		refSerie: raw.refSerie as string,
		refNumero: raw.refNumero as number,
	};
}
