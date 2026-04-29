import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	COD_LIBRO,
	aceptarPropuestaRvie,
	consultarTicket,
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
	test("RVIE uses gestionprocesosmasivos endpoint and returns ticket", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ numTicket: "20240100000001" }), { status: 200 });
		});
		const ticket = await descargarPropuesta({ codLibro: COD_LIBRO.rvie, perTributario: "202404" }, creds);
		expect(ticket).toBe("20240100000001");
		expect(seenUrl).toContain("exportapropuesta");
		expect(seenUrl).toContain("perTributario=202404");
		expect(seenUrl).toContain("codTipoArchivoReporte=0");
		expect(seenUrl).toContain("codOrigenEnvio=2");
	});

	test("RCE uses /rce/propuesta/.../exportacioncomprobantepropuesta path", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ numTicket: "T1" }), { status: 200 });
		});
		await descargarPropuesta({ codLibro: COD_LIBRO.rce, perTributario: "202404" }, creds);
		expect(seenUrl).toContain("/rce/propuesta/web/propuesta/202404/exportacioncomprobantepropuesta");
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
	test("returns first registro from response", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "06", desEstadoProceso: "Terminado", archivoReporte: [{ nomArchivoReporte: "out.zip", codTipoArchivoReporte: "0" }] }] }), { status: 200 });
		});
		const status = await consultarTicket("T1", creds);
		expect(status.codEstadoProceso).toBe("06");
		expect(status.archivoReporte?.[0].nomArchivoReporte).toBe("out.zip");
	});

	test("returns 'No encontrado' when registros is empty", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [] }), { status: 200 });
		});
		const status = await consultarTicket("Tx", creds);
		expect(status.codEstadoProceso).toBe("00");
		expect(status.desEstadoProceso).toContain("No encontrado");
	});
});

describe("pollTicket", () => {
	test("returns 'completed' when ticket reaches state 06", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "06", desEstadoProceso: "Terminado", archivoReporte: [{ nomArchivoReporte: "f.zip" }] }] }), { status: 200 });
		});
		const result = await pollTicket({ creds, numTicket: "T1", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 5000 });
		expect(result.state).toBe("completed");
		expect(result.archivoReporte?.[0].nomArchivoReporte).toBe("f.zip");
	});

	test("returns 'error' when ticket reaches state 07", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "07", desEstadoProceso: "Error en proceso" }] }), { status: 200 });
		});
		const result = await pollTicket({ creds, numTicket: "T1", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 5000 });
		expect(result.state).toBe("error");
		expect(result.statusDesc).toContain("Error");
	});

	test("returns 'still-processing' on timeout", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ registros: [{ numTicket: "T1", codEstadoProceso: "03", desEstadoProceso: "En proceso" }] }), { status: 200 });
		});
		const result = await pollTicket({ creds, numTicket: "T1", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 });
		expect(result.state).toBe("still-processing");
	});
});
