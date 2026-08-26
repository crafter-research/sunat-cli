import { describe, expect, test } from "bun:test";
import { cleanBuzonText, normalizeBuzonPages, normalizeBuzonRow } from "../../src/buzon/normalize.ts";
import { type BuzonPageFetcher, collectBuzon } from "../../src/buzon/portal.ts";
import type { BuzonKind, RawBuzonPage, RawBuzonRow } from "../../src/buzon/types.ts";
import pages from "../fixtures/buzon/pages.json";

const fixture = pages as Record<BuzonKind, RawBuzonPage[]>;

describe("Buzón metadata normalization", () => {
	test("removes terminal controls and line breaks from upstream text", () => {
		expect(cleanBuzonText("A\u001b[31m\nB\tC")).toBe("A B C");
	});

	test("preserves upstream values as observed data without legal interpretation", () => {
		const item = normalizeBuzonRow(((fixture.message[0].rows as RawBuzonRow[]) ?? [])[0] ?? {}, "message");
		expect(item).toMatchObject({
			id: "message:1001",
			kind: "message",
			validUntilObserved: "31/12/2099",
			stateCodeObserved: "0",
			attachmentCountObserved: 0,
			sourceEndpoint: "listNotiMenPag",
		});
		expect(item).not.toHaveProperty("deadline");
	});

	test("deduplicates rows and exposes contradictory totals", () => {
		const page = fixture.notification[0];
		const rows = (page.rows as RawBuzonRow[]) ?? [];
		const result = normalizeBuzonPages("notification", [{ ...page, rows: [...rows, ...rows] }]);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].subject).toBe("Notificación de prueba controlada");
		expect(result.summary).toEqual({
			kind: "notification",
			pagesFetched: 1,
			observedCount: 1,
			reportedTotalsObserved: [0],
			reportedRecordsObserved: [1],
			countMismatch: true,
		});
	});

	test("normalizes a bounded corpus of duplicated and malformed upstream rows", () => {
		const generated = Array.from({ length: 64 }, (_, index) => ({
			codMensaje: index + 1,
			desAsunto: `Row ${index}\u001b[31m\nvalue`,
			cantidadArchAdj: index === 63 ? "1.5" : index % 3 === 0 ? -1 : String(index % 4),
		}));
		const result = normalizeBuzonPages("message", [
			{
				endPage: 1,
				total: 64,
				records: 64,
				rows: [...generated, ...generated, null, "bad-row", { codMensaje: null }],
			},
		]);
		expect(result.items).toHaveLength(64);
		expect(new Set(result.items.map((item) => item.id)).size).toBe(64);
		expect(result.items.every((item) => !item.subject.includes("\u001b") && !item.subject.includes("\n"))).toBe(true);
		expect(result.items.every((item) => item.attachmentCountObserved >= 0)).toBe(true);
		expect(result.items.find((item) => item.id === "message:64")?.attachmentCountObserved).toBe(0);
		expect(result.summary.countMismatch).toBe(false);
	});
});

describe("Buzón pagination protocol", () => {
	test("serializes kinds and pages until the producer endPage", async () => {
		const calls: Array<[BuzonKind, number]> = [];
		const fetchPage: BuzonPageFetcher = async (kind, page) => {
			calls.push([kind, page]);
			return fixture[kind][page - 1] ?? { endPage: page, rows: [] };
		};
		const result = await collectBuzon(25, fetchPage);
		expect(calls).toEqual([
			["message", 1],
			["message", 2],
			["notification", 1],
		]);
		expect(result.items.map((item) => item.id)).toEqual(["message:1001", "message:1002", "notification:2001"]);
	});

	test("stops at the caller limit even when SUNAT advertises more pages", async () => {
		const calls: Array<[BuzonKind, number]> = [];
		const fetchPage: BuzonPageFetcher = async (kind, page) => {
			calls.push([kind, page]);
			return {
				endPage: 99,
				total: 99,
				records: 99,
				rows: [{ codMensaje: `${kind}-${page}`, desAsunto: "bounded" }],
			};
		};
		await collectBuzon(2, fetchPage);
		expect(calls).toEqual([
			["message", 1],
			["message", 2],
			["notification", 1],
			["notification", 2],
		]);
	});
});
