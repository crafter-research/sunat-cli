import type { BuzonItem, BuzonKind, BuzonKindSummary, RawBuzonPage, RawBuzonRow } from "./types.ts";

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

function scalarString(value: unknown): string | null {
	if (typeof value === "string" || typeof value === "number") return String(value);
	return null;
}

function observedNumber(value: unknown): number | null {
	const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function cleanBuzonText(value: unknown): string {
	const printable = [...String(value ?? "").replace(ANSI_ESCAPE_PATTERN, "")]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code <= 31 || (code >= 127 && code <= 159) ? " " : character;
		})
		.join("");
	return printable.replace(/\s+/g, " ").trim();
}

export function normalizeBuzonRow(row: RawBuzonRow, kind: BuzonKind): BuzonItem | null {
	const messageCode = scalarString(row.codMensaje);
	if (!messageCode) return null;
	return {
		id: `${kind}:${messageCode}`,
		messageCode,
		kind,
		subject: cleanBuzonText(row.desAsunto),
		sentAtObserved: scalarString(row.fecEnvio),
		publishedAtObserved: scalarString(row.fecPublica),
		validUntilObserved: scalarString(row.fecVigencia),
		stateCodeObserved: scalarString(row.indEstado),
		urgentObserved: observedNumber(row.indUrg) === 1,
		starredObserved: observedNumber(row.indDesta) === 1,
		noticeObserved: observedNumber(row.indAviso) === 1,
		attachmentCountObserved: observedNumber(row.cantidadArchAdj) ?? 0,
		folderCodeObserved: scalarString(row.codCarpeta),
		labelCodeObserved: scalarString(row.codEtiqueta),
		newSincePrevious: false,
		sourceEndpoint: "listNotiMenPag",
	};
}

function uniqueObservedNumbers(pages: RawBuzonPage[], key: "total" | "records"): number[] {
	return [
		...new Set(pages.map((page) => observedNumber(page[key])).filter((value): value is number => value !== null)),
	];
}

export function normalizeBuzonPages(
	kind: BuzonKind,
	pages: RawBuzonPage[],
): { items: BuzonItem[]; summary: BuzonKindSummary } {
	const items = new Map<string, BuzonItem>();
	for (const page of pages) {
		if (!Array.isArray(page.rows)) continue;
		for (const raw of page.rows) {
			if (!raw || typeof raw !== "object") continue;
			const item = normalizeBuzonRow(raw as RawBuzonRow, kind);
			if (item && !items.has(item.id)) items.set(item.id, item);
		}
	}
	const normalized = [...items.values()];
	const reportedTotalsObserved = uniqueObservedNumbers(pages, "total");
	const reportedRecordsObserved = uniqueObservedNumbers(pages, "records");
	const reported = [...reportedTotalsObserved, ...reportedRecordsObserved];
	return {
		items: normalized,
		summary: {
			kind,
			pagesFetched: pages.length,
			observedCount: normalized.length,
			reportedTotalsObserved,
			reportedRecordsObserved,
			countMismatch: reported.length > 0 && reported.some((value) => value !== normalized.length),
		},
	};
}

export function pageRows(page: RawBuzonPage): RawBuzonRow[] {
	return Array.isArray(page.rows) ? (page.rows.filter((row) => row && typeof row === "object") as RawBuzonRow[]) : [];
}

export function pageEnd(page: RawBuzonPage): number | null {
	return observedNumber(page.endPage);
}
