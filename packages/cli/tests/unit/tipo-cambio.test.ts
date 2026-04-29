import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadCachedTc, parseTcSnapshot, saveTc } from "../../src/sunat-rest/tipo-cambio.ts";
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

describe("parseTcSnapshot — pure parser", () => {
	test("aria-label style 'Compra X Venta Y'", () => {
		const snap = "Tipo de Cambio Bancario\nCompra 3.760 Venta 3.768\n";
		const r = parseTcSnapshot(snap, "2026-04-29");
		expect(r).toEqual({ compra: 3.76, venta: 3.768 });
	});

	test("aria-label with colons 'Compra: X Venta: Y'", () => {
		const snap = "Compra: 3.755   Venta: 3.770";
		const r = parseTcSnapshot(snap, "2026-04-29");
		expect(r).toEqual({ compra: 3.755, venta: 3.77 });
	});

	test("table row '3.760 | 3.768'", () => {
		const snap = "29 Abril 2026 | 3.760 | 3.768";
		const r = parseTcSnapshot(snap, "2026-04-29");
		expect(r).not.toBeNull();
		expect(r?.compra).toBe(3.76);
		expect(r?.venta).toBe(3.768);
	});

	test("normalizes order so compra <= venta", () => {
		const snap = "3.770 | 3.755"; // accidentally swapped
		const r = parseTcSnapshot(snap, "2026-04-29");
		expect(r?.compra).toBe(3.755);
		expect(r?.venta).toBe(3.77);
	});

	test("rejects unrelated decimals (e.g. weights, totals)", () => {
		const snap = "Peso bruto: 100.00 | Peso neto: 99.50";
		const r = parseTcSnapshot(snap, "2026-04-29");
		// Sanity check filter: weights are >10 so should be rejected
		expect(r).toBeNull();
	});

	test("returns null on empty/garbage", () => {
		expect(parseTcSnapshot("", "2026-04-29")).toBeNull();
		expect(parseTcSnapshot("just text", "2026-04-29")).toBeNull();
	});

	test("handles 4-decimal values (some TC sources)", () => {
		const snap = "Compra 3.7625 Venta 3.7700";
		const r = parseTcSnapshot(snap, "2026-04-29");
		expect(r?.compra).toBe(3.7625);
		expect(r?.venta).toBe(3.77);
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
