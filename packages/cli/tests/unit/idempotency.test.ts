/**
 * Note: idempotency module reads `paths.auditDir` which is cached at import
 * time from $HOME. To avoid polluting the dev's real audit log, we write
 * test entries with collision-proof IDs (very high numero + unique RUC).
 * Tests clean up after themselves.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { findCachedResult, findStalePendings, idempotencyKey } from "../../src/cpe/idempotency.ts";
import { paths } from "../../src/data/config.ts";

const TEST_RUC = "29999999999";
const TEST_TAG = "TEST_IDEMPOTENCY";
const currentMonth = () => new Date().toISOString().slice(0, 7);
let auditFile: string;

beforeAll(() => {
	mkdirSync(paths.auditDir, { recursive: true });
	auditFile = join(paths.auditDir, `${currentMonth()}.jsonl`);
});

afterAll(() => {
	if (!existsSync(auditFile)) return;
	const filtered = readFileSync(auditFile, "utf-8")
		.split("\n")
		.filter((l) => !l.includes(TEST_TAG))
		.join("\n");
	writeFileSync(auditFile, filtered);
});

afterEach(() => {
	if (!existsSync(auditFile)) return;
	const filtered = readFileSync(auditFile, "utf-8")
		.split("\n")
		.filter((l) => !l.includes(TEST_TAG))
		.join("\n");
	writeFileSync(auditFile, filtered);
});

function appendTestEntry(entry: Record<string, unknown>): void {
	const tagged = { ...entry, _testTag: TEST_TAG };
	const existing = existsSync(auditFile) ? readFileSync(auditFile, "utf-8") : "";
	writeFileSync(auditFile, `${existing}${JSON.stringify(tagged)}\n`);
}

const KEY = { emisorRuc: TEST_RUC, tipo: "01" as const, serie: "FT99", numero: 99999991 };

describe("idempotencyKey", () => {
	test("formats as RUC-TIPO-SERIE-NUMERO", () => {
		expect(idempotencyKey({ emisorRuc: "20131312955", tipo: "01", serie: "F001", numero: 1234 })).toBe(
			"20131312955-01-F001-1234",
		);
	});
});

describe("findCachedResult", () => {
	test("returns null when no matching success entry exists for unknown key", () => {
		expect(findCachedResult({ ...KEY, numero: 99999992 })).toBeNull();
	});

	test("returns cached CpeResult when matching success entry exists", () => {
		appendTestEntry({
			timestamp: "2026-04-29T00:00:00Z",
			command: "cpe factura emit",
			args: {},
			result: "success",
			details: {
				id: idempotencyKey(KEY),
				hash: "sha256:abc",
				status: "accepted",
				cdrCode: "0",
				cdrDesc: "La Factura ha sido aceptada",
				xml: "<Invoice/>",
			},
		});
		const cached = findCachedResult(KEY);
		expect(cached).not.toBeNull();
		expect(cached?.cdrCode).toBe("0");
		expect(cached?.status).toBe("accepted");
		expect(cached?.serie).toBe(KEY.serie);
		expect(cached?.numero).toBe(KEY.numero);
		expect(cached?.id).toBe(idempotencyKey(KEY));
	});

	test("ignores entries with result != success", () => {
		appendTestEntry({
			timestamp: "2026-04-29T00:00:00Z",
			command: "cpe factura emit",
			args: {},
			result: "pending",
			details: { id: idempotencyKey(KEY) },
		});
		appendTestEntry({
			timestamp: "2026-04-29T00:01:00Z",
			command: "cpe factura emit",
			args: {},
			result: "error",
			details: { id: idempotencyKey(KEY), error: "x" },
		});
		expect(findCachedResult(KEY)).toBeNull();
	});

	test("skips malformed JSONL lines without throwing", () => {
		const existing = existsSync(auditFile) ? readFileSync(auditFile, "utf-8") : "";
		writeFileSync(auditFile, `${existing}not json line\n`);
		appendTestEntry({
			timestamp: "2026-04-29T00:00:00Z",
			command: "cpe factura emit",
			args: {},
			result: "success",
			details: { id: idempotencyKey(KEY), cdrCode: "0", status: "accepted" },
		});
		expect(findCachedResult(KEY)?.cdrCode).toBe("0");
	});
});

describe("findStalePendings", () => {
	test("does NOT return pending entries less than 1 hour old", () => {
		appendTestEntry({
			timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
			command: "cpe factura emit",
			args: {},
			result: "pending",
			details: { id: idempotencyKey(KEY) },
		});
		const stale = findStalePendings();
		const taggedStale = stale.filter((e) => (e as unknown as { _testTag?: string })._testTag === TEST_TAG);
		expect(taggedStale.length).toBe(0);
	});

	test("returns pending entries older than 1 hour", () => {
		appendTestEntry({
			timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
			command: "cpe factura emit",
			args: {},
			result: "pending",
			details: { id: idempotencyKey(KEY) },
		});
		const stale = findStalePendings();
		const taggedStale = stale.filter((e) => (e as unknown as { _testTag?: string })._testTag === TEST_TAG);
		expect(taggedStale.length).toBe(1);
	});

	test("does NOT return success or error entries even when old", () => {
		appendTestEntry({
			timestamp: "2020-01-01T00:00:00Z",
			command: "cpe factura emit",
			args: {},
			result: "success",
			details: { id: "X" },
		});
		appendTestEntry({
			timestamp: "2020-01-01T00:00:00Z",
			command: "cpe factura emit",
			args: {},
			result: "error",
			details: { id: "Y" },
		});
		const stale = findStalePendings();
		const taggedStale = stale.filter((e) => (e as unknown as { _testTag?: string })._testTag === TEST_TAG);
		expect(taggedStale.length).toBe(0);
	});
});
