import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	COD_LIBRO,
	aceptarPropuestaRvie,
	archivoDeTicket,
	consultarTicket,
	descargarArchivo,
	descargarPropuesta,
	descargarRvie,
	listarPeriodos,
	pollTicket,
	sireCredentials,
} from "../../src/sunat-rest/sire.ts";
import { clearTokenCache } from "../../src/sunat-rest/oauth.ts";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => clearTokenCache());
afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
	global.fetch = mock(async (url, init) => impl(String(url), init as RequestInit));
}

const creds = sireCredentials({
	clientId: "cid",
	clientSecret: "csec",
	ruc: "20131312955",
	solUsuario: "MODDATOS",
	solPassword: "moddatos",
});

describe("sireCredentials", () => {
	test("concats RUC + SOL_USER for username", () => {
		expect(creds.username).toBe("20131312955MODDATOS");
		expect(creds.password).toBe("moddatos");
		expect(creds.scope).toContain("api-sire.sunat.gob.pe");
	});
});

describe("OAuth password grant for SIRE", () => {
	test("posts to clientessol with grant_type=password + username + password", async () => {
		let tokenUrl = "";
		let tokenBody = "";
		mockFetch(async (url, init) => {
			if (url.includes("/oauth2/token")) {
				tokenUrl = url;
				tokenBody = String(init?.body || "");
				return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			}
			return new Response(JSON.stringify({ registros: [] }), { status: 200 });
		});
		await listarPeriodos(COD_LIBRO.rvie, creds);
		expect(tokenUrl).toContain("/clientessol/cid/oauth2/token/");
		expect(tokenBody).toContain("grant_type=password");
		expect(tokenBody).toContain("username=20131312955MODDATOS");
		expect(tokenBody).toContain("password=moddatos");
	});
});

describe("COD_LIBRO", () => {
	test("RVIE = 140000, RCE = 080000", () => {
		expect(COD_LIBRO.rvie).toBe("140000");
		expect(COD_LIBRO.rce).toBe("080000");
	});
});

describe("listarPeriodos", () => {
	test("hits api-sire host with codLibro in path", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ registros: [{ numEjercicio: "2024", desEstado: "Activo", lisPeriodos: [] }] }), { status: 200 });
		});
		await listarPeriodos(COD_LIBRO.rvie, creds);
		expect(seenUrl).toContain("api-sire.sunat.gob.pe");
		expect(seenUrl).toContain("/rvierce/padron/web/omisos/140000/periodos");
	});

	test("normalizes both array and {registros} response shapes", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify([{ numEjercicio: "2025", desEstado: "Activo", lisPeriodos: [{ perTributario: "202504", codEstado: "01", desEstado: "Pendiente" }] }]), { status: 200 });
		});
		const ejercicios = await listarPeriodos(COD_LIBRO.rce, creds);
		expect(ejercicios.length).toBe(1);
		expect(ejercicios[0].numEjercicio).toBe("2025");
		expect(ejercicios[0].lisPeriodos[0].perTributario).toBe("202504");
	});
});

describe("descargarPropuesta", () => {
	// Manual API Registro de Ventas v30 §5.18: the export lives in the book's
	// propuesta module with the period in the path, and the format parameter is
	// codTipoArchivo. The v22 route under gestionprocesosmasivos is answered by
	// the gateway with a bare nginx 500, like any route that does not exist.
	test("RVIE exports from /rvie/propuesta/.../{periodo}/exportapropuesta and returns ticket", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ numTicket: "20240100000001" }), { status: 200 });
		});
		const ticket = await descargarPropuesta({ codLibro: COD_LIBRO.rvie, perTributario: "202404" }, creds);
		expect(ticket).toBe("20240100000001");
		expect(seenUrl).toContain("/rvie/propuesta/web/propuesta/202404/exportapropuesta");
		expect(seenUrl).not.toContain("gestionprocesosmasivos");
		expect(seenUrl).toContain("codTipoArchivo=0");
		expect(seenUrl).not.toContain("codTipoArchivoReporte");
	});

	// Manual SIRE Compras v28 §5.34. SUNAT answers 422 "El campo 'codOrigenEnvio'
	// es nulo o vacio" when the origin is missing.
	test("RCE exports from /rce/propuesta/.../{periodo}/exportacioncomprobantepropuesta with codOrigenEnvio", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ numTicket: "T1" }), { status: 200 });
		});
		await descargarPropuesta({ codLibro: COD_LIBRO.rce, perTributario: "202404" }, creds);
		expect(seenUrl).toContain("/rce/propuesta/web/propuesta/202404/exportacioncomprobantepropuesta");
		expect(seenUrl).toContain("codTipoArchivo=0");
		expect(seenUrl).toContain("codOrigenEnvio=2");
	});
});

describe("descargarRvie", () => {
	test("hits exportarregistropropuesta and returns ticket", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ numTicket: "T2" }), { status: 200 });
		});
		const ticket = await descargarRvie("202404", creds);
		expect(ticket).toBe("T2");
		expect(seenUrl).toContain("exportarregistropropuesta");
		expect(seenUrl).toContain("codLibro=140000");
	});
});

describe("aceptarPropuestaRvie", () => {
	test("POSTs to /rvie/propuesta/web/propuesta/{periodo}/aceptapropuesta", async () => {
		let seenUrl = "";
		let seenMethod = "";
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			seenMethod = (init?.method as string) || "GET";
			return new Response(JSON.stringify({ numTicket: "T3" }), { status: 200 });
		});
		const result = await aceptarPropuestaRvie("202404", creds);
		expect(result.numTicket).toBe("T3");
		expect(seenMethod).toBe("POST");
		expect(seenUrl).toContain("/rvie/propuesta/web/propuesta/202404/aceptapropuesta");
	});
});

describe("consultarTicket", () => {
	// Manual API Registro de Ventas v30 §5.16: consultaestadotickets lists tickets
	// per period; perIni/perFin are mandatory and a query by numTicket alone is 422.
	test("queries the period window and returns the matching registro", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ registros: [
				{ numTicket: "T0", codEstadoProceso: "06", desEstadoProceso: "Terminado" },
				{ numTicket: "T1", codEstadoProceso: "06", desEstadoProceso: "Terminado", codProceso: "10", archivoReporte: [{ nomArchivoReporte: "out.zip", codTipoAchivoReporte: "00" }] },
			] }), { status: 200 });
		});
		const status = await consultarTicket("T1", creds, "202404");
		expect(seenUrl).toContain("perIni=202404");
		expect(seenUrl).toContain("perFin=202404");
		expect(seenUrl).toContain("numTicket=T1");
		expect(status.numTicket).toBe("T1");
		expect(status.codProceso).toBe("10");
		expect(status.archivoReporte?.[0].nomArchivoReporte).toBe("out.zip");
	});

	test("returns 'No encontrado' when the ticket is not in the period's listing", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "other", codEstadoProceso: "06", desEstadoProceso: "Terminado" }] }), { status: 200 });
		});
		const status = await consultarTicket("Tx", creds, "202404");
		expect(status.codEstadoProceso).toBe("00");
		expect(status.desEstadoProceso).toContain("No encontrado");
	});
});

describe("descargarArchivo", () => {
	// Manual API Registro de Ventas v30 §5.17 lists perTributario, codProceso and
	// numTicket as mandatory; the server answers 500 without codProceso or numTicket.
	test("sends codProceso and numTicket alongside the file name", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(new Uint8Array([0x50, 0x4b]), { status: 200 });
		});
		const buf = await descargarArchivo(
			{ nomArchivoReporte: "LE0000000000020240400080400021112.zip", codTipoArchivoReporte: "00", codLibro: COD_LIBRO.rce, perTributario: "202404", codProceso: "10", numTicket: "20240100000001" },
			creds,
		);
		expect(buf.length).toBe(2);
		expect(seenUrl).toContain("nomArchivoReporte=LE0000000000020240400080400021112.zip");
		expect(seenUrl).toContain("codTipoArchivoReporte=00");
		expect(seenUrl).toContain("codLibro=080000");
		expect(seenUrl).toContain("perTributario=202404");
		expect(seenUrl).toContain("codProceso=10");
		expect(seenUrl).toContain("numTicket=20240100000001");
	});
});

describe("archivoDeTicket", () => {
	test("assembles download options from a finished ticket, reading SUNAT's misspelled type field", () => {
		const opts = archivoDeTicket(
			{ numTicket: "T1", codProceso: "10", archivoReporte: [{ nomArchivoReporte: "a.zip", codTipoAchivoReporte: "00" }] },
			COD_LIBRO.rvie,
			"202404",
		);
		expect(opts).toEqual({ nomArchivoReporte: "a.zip", codTipoArchivoReporte: "00", codLibro: "140000", perTributario: "202404", codProceso: "10", numTicket: "T1" });
	});

	test("returns null when the ticket lists no file or no process", () => {
		expect(archivoDeTicket({ numTicket: "T1", codProceso: "10" }, COD_LIBRO.rvie, "202404")).toBeNull();
		expect(archivoDeTicket({ numTicket: "T1", archivoReporte: [{ nomArchivoReporte: "a" }] }, COD_LIBRO.rvie, "202404")).toBeNull();
	});
});

describe("pollTicket", () => {
	test("returns 'completed' when ticket reaches state 06", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "06", desEstadoProceso: "Terminado", archivoReporte: [{ nomArchivoReporte: "f.zip" }] }] }), { status: 200 });
		});
		const result = await pollTicket({ creds, numTicket: "T1", perTributario: "202404", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 5000 });
		expect(result.state).toBe("completed");
		expect(result.numTicket).toBe("T1");
		expect(result.archivoReporte?.[0].nomArchivoReporte).toBe("f.zip");
	});

	test("returns 'error' when ticket reaches state 07", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "07", desEstadoProceso: "Error en proceso" }] }), { status: 200 });
		});
		const result = await pollTicket({ creds, numTicket: "T1", perTributario: "202404", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 5000 });
		expect(result.state).toBe("error");
		expect(result.statusDesc).toContain("Error");
	});

	test("returns 'still-processing' on timeout", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "03", desEstadoProceso: "En proceso" }] }), { status: 200 });
		});
		const result = await pollTicket({ creds, numTicket: "T1", perTributario: "202404", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 });
		expect(result.state).toBe("still-processing");
	});
});
