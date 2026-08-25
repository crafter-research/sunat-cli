import { describe, expect, test } from "bun:test";
import { fmtAge, fmtDireccion, styleCondicion, styleEstado } from "../../src/commands/padron/index.ts";
import { isStale, parsePadronLine } from "../../src/sunat-rest/padron-local.ts";
import { setColorOverride, stripAnsi } from "../../src/utils/style.ts";

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

describe("padron human view", () => {
	test("fmtAge states the magnitude a reader would otherwise compute", () => {
		const now = new Date("2026-08-25T12:00:00Z").getTime();
		expect(fmtAge("2026-08-25T11:59:40Z", now)).toBe("just now");
		expect(fmtAge("2026-08-25T11:15:00Z", now)).toBe("45 min ago");
		expect(fmtAge("2026-08-25T07:00:00Z", now)).toBe("5h ago");
		expect(fmtAge("2026-08-22T12:00:00Z", now)).toBe("3 days ago");
		// The real cache state that made the raw ISO timestamp unreadable.
		expect(fmtAge("2026-04-29T05:10:29.908Z", now)).toBe("118 days ago (3 months)");
		expect(fmtAge("not-a-date", now)).toBe("unknown");
	});

	// Colour is asserted with an override because a test runner has no TTY, so
	// without forcing it every styling function returns raw text and the mapping
	// under test is never exercised.
	test("estado and condicion never reach for danger, which is reserved for errors", () => {
		setColorOverride(true);
		const DANGER = "38;5;203";
		for (const v of ["ACTIVO", "SUSPENSION TEMPORAL", "BAJA DE OFICIO", "BAJA DEFINITIVA", "ANULACION - ERROR SU"]) {
			expect(styleEstado(v)).not.toContain(DANGER);
		}
		for (const v of ["HABIDO", "NO HABIDO", "NO HALLADO CERRADO", "NO APLICABLE"]) {
			expect(styleCondicion(v)).not.toContain(DANGER);
		}
		setColorOverride(null);
	});

	test("state maps to its semantic colour, measured against the real padrón distribution", () => {
		setColorOverride(true);
		const OK = "38;5;78";
		const WARN = "38;5;214";
		const MUTED = "38;5;245";
		expect(styleEstado("ACTIVO")).toContain(OK);
		expect(styleEstado("SUSPENSION TEMPORAL")).toContain(WARN);
		expect(styleEstado("BAJA DE OFICIO")).toContain(MUTED);
		expect(styleCondicion("HABIDO")).toContain(OK);
		expect(styleCondicion("NO HABIDO")).toContain(WARN);
		expect(styleCondicion("NO HALLADO CERRADO")).toContain(WARN);
		expect(styleCondicion("NO APLICABLE")).toContain(MUTED);
		setColorOverride(null);
	});

	test("styling leaves the words intact so NO_COLOR loses nothing but colour", () => {
		setColorOverride(true);
		expect(stripAnsi(styleEstado("BAJA DEFINITIVA"))).toBe("BAJA DEFINITIVA");
		expect(stripAnsi(styleCondicion("NO HALLADO CERRADO"))).toBe("NO HALLADO CERRADO");
		setColorOverride(false);
		expect(styleEstado("ACTIVO")).toBe("ACTIVO");
		setColorOverride(null);
	});

	// SUNAT's own placeholder is a literal "-", so a dash means absent, not short.
	test("an all-placeholder address yields no address block", () => {
		const dashes = {
			ruc: "10712392563",
			razonSocial: "X",
			estado: "ACTIVO",
			condicion: "HABIDO",
			ubigeo: "-",
			tipoVia: "-",
			nombreVia: "-",
			codigoZona: "-",
			tipoZona: "-",
			numero: "-",
			interior: "-",
			lote: "-",
			manzana: "-",
			kilometro: "-",
		};
		expect(fmtDireccion(dashes)).toBeUndefined();
	});

	test("real address components are joined, absent ones omitted", () => {
		expect(
			fmtDireccion({
				ruc: "20131312955",
				razonSocial: "MINISTERIO DE EDUCACION",
				estado: "ACTIVO",
				condicion: "HABIDO",
				ubigeo: "150101",
				tipoVia: "AV.",
				nombreVia: "JAVIER PRADO ESTE",
				numero: "1234",
			}),
		).toBe("AV. JAVIER PRADO ESTE, Nro. 1234");
	});
});
