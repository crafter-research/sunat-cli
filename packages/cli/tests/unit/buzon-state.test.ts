import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { applyBuzonChanges, BuzonStateError, readBuzonState } from "../../src/buzon/state.ts";
import type { BuzonItem, BuzonListResult } from "../../src/buzon/types.ts";
import { paths } from "../../src/data/config.ts";

function item(id: string): BuzonItem {
	const messageCode = id.split(":")[1] ?? id;
	return {
		id,
		messageCode,
		kind: id.startsWith("message:") ? "message" : "notification",
		subject: `Subject ${messageCode}`,
		sentAtObserved: "25/08/2026 09:00",
		publishedAtObserved: null,
		validUntilObserved: null,
		stateCodeObserved: "0",
		urgentObserved: false,
		starredObserved: false,
		noticeObserved: false,
		attachmentCountObserved: 0,
		folderCodeObserved: "00",
		labelCodeObserved: null,
		newSincePrevious: false,
		sourceEndpoint: "listNotiMenPag",
	};
}

function result(items: BuzonItem[]): Omit<BuzonListResult, "changes"> {
	return {
		version: "1.0.0",
		fetchedAt: new Date().toISOString(),
		source: "SUNAT Buzón SOL legacy visor",
		readOnlyBoundary: "metadata-only",
		overview: { foldersObserved: 0, alertsObserved: 0 },
		summaries: [],
		items,
	};
}

beforeEach(() => rmSync(paths.buzonDir, { recursive: true, force: true }));
afterEach(() => rmSync(paths.buzonDir, { recursive: true, force: true }));

describe("private Buzón state", () => {
	test("creates a private baseline and detects only later identities as new", () => {
		const first = applyBuzonChanges(result([item("message:1")]));
		expect(first.changes).toEqual({
			baselineCreated: true,
			newCount: 0,
			knownCount: 1,
			missingCount: 0,
			totalCount: 1,
		});
		const second = applyBuzonChanges(result([item("message:1"), item("notification:2")]));
		expect(second.changes).toEqual({
			baselineCreated: false,
			newCount: 1,
			knownCount: 1,
			missingCount: 0,
			totalCount: 2,
		});
		expect(second.items.find((entry) => entry.id === "notification:2")?.newSincePrevious).toBe(true);
		const third = applyBuzonChanges(result([item("notification:2")]));
		expect(third.changes).toEqual({
			baselineCreated: false,
			newCount: 0,
			knownCount: 1,
			missingCount: 1,
			totalCount: 1,
		});
		expect(statSync(paths.buzonDir).mode & 0o777).toBe(0o700);
		expect(statSync(paths.buzonState).mode & 0o777).toBe(0o600);
	});

	test("persists only the allowlisted metadata contract", () => {
		const unsafe = { ...item("message:1"), body: "private body", sessionUrl: "https://example.test/?token=secret" };
		applyBuzonChanges(result([unsafe]));
		const stored = readFileSync(paths.buzonState, "utf8");
		expect(stored).not.toContain("private body");
		expect(stored).not.toContain("token=secret");
		expect(stored).toContain('"readOnlyBoundary": "metadata-only"');
	});

	test("repairs permissive state before reading it", () => {
		applyBuzonChanges(result([item("message:1")]));
		chmodSync(paths.buzonDir, 0o755);
		chmodSync(paths.buzonState, 0o644);
		expect(readBuzonState()?.items).toHaveLength(1);
		expect(statSync(paths.buzonDir).mode & 0o777).toBe(0o700);
		expect(statSync(paths.buzonState).mode & 0o777).toBe(0o600);
	});

	test("rejects corrupted state without exposing its contents", () => {
		applyBuzonChanges(result([item("message:1")]));
		writeFileSync(paths.buzonState, "private malformed data", { mode: 0o600 });
		expect(() => readBuzonState()).toThrow(BuzonStateError);
		try {
			readBuzonState();
		} catch (error) {
			expect(String(error)).not.toContain("private malformed data");
		}
	});

	test("rejects an incomplete nested contract", () => {
		applyBuzonChanges(result([item("message:1")]));
		const state = JSON.parse(readFileSync(paths.buzonState, "utf8"));
		delete state.changes.totalCount;
		writeFileSync(paths.buzonState, JSON.stringify(state), { mode: 0o600 });
		expect(() => readBuzonState()).toThrow(BuzonStateError);
	});
});
