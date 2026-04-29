import { describe, expect, test } from "bun:test";
import { isStale, parsePadronLine } from "../../src/sunat-rest/padron-local.ts";

describe("parsePadronLine", () => {
	test("parses canonical 13-column padrón line", () => {
		const line = "20131312955|MINISTERIO DE EDUCACION|ACTIVO|HABIDO|150101|AV.|JAVIER PRADO ESTE| | |1234| |LOTE 1| | ";
		const e = parsePadronLine(line);
		expect(e?.ruc).toBe("20131312955");
		expect(e?.razonSocial).toBe("MINISTERIO DE EDUCACION");
		expect(e?.estado).toBe("ACTIVO");
		expect(e?.condicion).toBe("HABIDO");
		expect(e?.ubigeo).toBe("150101");
		expect(e?.tipoVia).toBe("AV.");
		expect(e?.nombreVia).toBe("JAVIER PRADO ESTE");
		expect(e?.numero).toBe("1234");
	});

	test("rejects non-RUC lines (header etc)", () => {
		expect(parsePadronLine("RUC|RAZON|ESTADO|CONDICION")).toBeNull();
		expect(parsePadronLine("")).toBeNull();
		expect(parsePadronLine("not a line")).toBeNull();
	});

	test("requires exactly 11-digit RUC", () => {
		expect(parsePadronLine("12345|X|A|H")).toBeNull();
		expect(parsePadronLine("1234567890123|X|A|H")).toBeNull();
	});

	test("trims fields and treats empty optionals as undefined", () => {
		const line = "20100000001|EMPRESA SAC | ACTIVO | HABIDO | 150101 | | | | | | | | | ";
		const e = parsePadronLine(line);
		expect(e?.razonSocial).toBe("EMPRESA SAC");
		expect(e?.estado).toBe("ACTIVO");
		expect(e?.tipoVia).toBeUndefined();
	});
});

describe("isStale", () => {
	test("null meta is stale", () => {
		expect(isStale(null)).toBe(true);
	});
	test("fresh meta (now) is not stale", () => {
		expect(isStale({ lastFetchedAt: new Date().toISOString(), zipSize: 1, zipSha256: "x", txtPath: "/x" })).toBe(false);
	});
	test("meta older than 24h is stale", () => {
		const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
		expect(isStale({ lastFetchedAt: old, zipSize: 1, zipSha256: "x", txtPath: "/x" })).toBe(true);
	});
	test("meta from 12h ago is not stale", () => {
		const ago = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
		expect(isStale({ lastFetchedAt: ago, zipSize: 1, zipSha256: "x", txtPath: "/x" })).toBe(false);
	});
});
