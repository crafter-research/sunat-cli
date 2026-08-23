import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadCachedTc, saveTc, selectRateForDate } from "../../src/sunat-rest/tipo-cambio.ts";
import { paths } from "../../src/data/config.ts";

const CACHE_FILE = join(paths.sunatDir, "cache", "tipo-cambio.jsonl");
const TEST_TAG_DATE = "2099-01-01"; // collision-proof — never a real TC date

beforeAll(() => {
	if (!existsSync(join(paths.sunatDir, "cache"))) mkdirSync(join(paths.sunatDir, "cache"), { recursive: true });
});

afterEach(() => {
	if (!existsSync(CACHE_FILE)) return;
	const filtered = readFileSync(CACHE_FILE, "utf-8")
		.split("\n")
		.filter((l) => l.trim().length > 0 && !l.includes(TEST_TAG_DATE) && !l.includes("2099-"))
		.join("\n");
	writeFileSync(CACHE_FILE, filtered ? `${filtered}\n` : "");
});

afterAll(() => {
	if (!existsSync(CACHE_FILE)) return;
	const filtered = readFileSync(CACHE_FILE, "utf-8")
		.split("\n")
		.filter((l) => l.trim().length > 0 && !l.includes("2099-"))
		.join("\n");
	writeFileSync(CACHE_FILE, filtered ? `${filtered}\n` : "");
});

const row = (fecPublica: string, valTipo: string, codTipo: "C" | "V") => ({ fecPublica, valTipo, codTipo });

describe("selectRateForDate — pure selector", () => {
	test("picks the compra/venta pair published on the exact date", () => {
		const rows = [
			row("01/11/2025", "3.372", "C"),
			row("01/11/2025", "3.379", "V"),
			row("17/11/2025", "3.365", "C"),
			row("17/11/2025", "3.374", "V"),
		];
		expect(selectRateForDate(rows, "2025-11-17")).toEqual({ compra: 3.365, venta: 3.374, publicada: "2025-11-17" });
	});

	test("falls back to the last rate published before the date", () => {
		const rows = [
			row("14/11/2025", "3.360", "C"),
			row("14/11/2025", "3.370", "V"),
			row("20/11/2025", "3.400", "C"),
			row("20/11/2025", "3.410", "V"),
		];
		// Nothing published on the 17th: the valid TC is the 14th's.
		expect(selectRateForDate(rows, "2025-11-17")).toEqual({ compra: 3.36, venta: 3.37, publicada: "2025-11-14" });
	});

	test("never picks a rate published after the requested date", () => {
		const rows = [row("20/11/2025", "3.400", "C"), row("20/11/2025", "3.410", "V")];
		expect(selectRateForDate(rows, "2025-11-17")).toBeNull();
	});

	test("returns null when a date has compra but no venta", () => {
		const rows = [row("17/11/2025", "3.365", "C")];
		expect(selectRateForDate(rows, "2025-11-17")).toBeNull();
	});

	test("returns null on empty input", () => {
		expect(selectRateForDate([], "2025-11-17")).toBeNull();
	});

	test("orders dates chronologically, not lexically by DD/MM/YYYY", () => {
		// Lexical sort on "DD/MM/YYYY" would rank 30/11 below 02/12.
		const rows = [
			row("30/11/2025", "3.300", "C"),
			row("30/11/2025", "3.310", "V"),
			row("02/12/2025", "3.500", "C"),
			row("02/12/2025", "3.510", "V"),
		];
		expect(selectRateForDate(rows, "2025-12-05")?.publicada).toBe("2025-12-02");
	});
});

describe("saveTc / loadCachedTc — JSONL cache", () => {
	test("save then load returns same record", () => {
		const rate = {
			fecha: "2099-04-01",
			compra: 3.5,
			venta: 3.51,
			moneda: "USD" as const,
			source: "sunat" as const,
			fetchedAt: new Date().toISOString(),
		};
		saveTc(rate);
		const loaded = loadCachedTc("2099-04-01");
		expect(loaded?.compra).toBe(3.5);
		expect(loaded?.venta).toBe(3.51);
	});

	test("returns null for missing fecha", () => {
		expect(loadCachedTc("2099-12-31")).toBeNull();
	});

	test("dedupes by fecha — second save replaces first", () => {
		const fecha = "2099-04-02";
		saveTc({ fecha, compra: 3.5, venta: 3.51, moneda: "USD", source: "sunat", fetchedAt: "x" });
		saveTc({ fecha, compra: 3.6, venta: 3.61, moneda: "USD", source: "sunat", fetchedAt: "y" });
		const loaded = loadCachedTc(fecha);
		expect(loaded?.compra).toBe(3.6);
		expect(loaded?.venta).toBe(3.61);
		// Verify no duplicate row
		const lines = readFileSync(CACHE_FILE, "utf-8")
			.split("\n")
			.filter((l) => l.includes(fecha));
		expect(lines.length).toBe(1);
	});

	test("skips malformed JSONL lines without throwing", () => {
		writeFileSync(CACHE_FILE, "not json\n");
		saveTc({
			fecha: "2099-04-03",
			compra: 3.5,
			venta: 3.51,
			moneda: "USD",
			source: "sunat",
			fetchedAt: "x",
		});
		expect(loadCachedTc("2099-04-03")?.compra).toBe(3.5);
	});
});
