import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { consultarGreTicket, enviarGre, greCredentials, pollGreTicket } from "../../src/sunat-rest/gre.ts";
import { clearTokenCache } from "../../src/sunat-rest/oauth.ts";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => clearTokenCache());
afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
	global.fetch = mock(async (url, init) => impl(String(url), init as RequestInit));
}

const creds = greCredentials({
	clientId: "cid",
	clientSecret: "csec",
	ruc: "20131312955",
	solUsuario: "MODDATOS",
	solPassword: "moddatos",
});

describe("greCredentials", () => {
	test("password grant with api-cpe scope", () => {
		expect(creds.username).toBe("20131312955MODDATOS");
		expect(creds.password).toBe("moddatos");
		expect(creds.scope).toContain("api-cpe.sunat.gob.pe");
	});
});

describe("OAuth password grant for GRE", () => {
	test("posts to clientessol with scope api-cpe", async () => {
		let tokenBody = "";
		mockFetch(async (url, init) => {
			if (url.includes("/oauth2/token")) {
				tokenBody = String(init?.body || "");
				return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			}
			return new Response(JSON.stringify({ numTicket: "T1" }), { status: 200 });
		});
		await enviarGre({ filename: "20131312955-09-T001-1", signedXml: "<DespatchAdvice/>" }, creds);
		expect(tokenBody).toContain("grant_type=password");
		expect(tokenBody).toContain("scope=https%3A%2F%2Fapi-cpe.sunat.gob.pe");
	});
});

describe("enviarGre", () => {
	test("POSTs to /v1/contribuyente/gem/comprobantes/{filename} on api-cpe host", async () => {
		let seenUrl = "";
		let seenMethod = "";
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			seenMethod = (init?.method as string) || "GET";
			return new Response(JSON.stringify({ numTicket: "20240100000001" }), { status: 200 });
		});
		const r = await enviarGre({ filename: "20131312955-09-T001-1", signedXml: "<x/>" }, creds);
		expect(seenMethod).toBe("POST");
		expect(seenUrl).toContain("api-cpe.sunat.gob.pe");
		expect(seenUrl).toContain("/contribuyente/gem/comprobantes/20131312955-09-T001-1");
		expect(r.numTicket).toBe("20240100000001");
	});

	test("body has archivo.{nomArchivo, arcGreZip, hashZip}", async () => {
		let body: { archivo?: { nomArchivo?: string; arcGreZip?: string; hashZip?: string } } = {};
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			body = JSON.parse(String(init?.body || "{}"));
			return new Response(JSON.stringify({ numTicket: "T1" }), { status: 200 });
		});
		await enviarGre({ filename: "20131312955-09-T001-1", signedXml: "<DespatchAdvice/>" }, creds);
		expect(body.archivo?.nomArchivo).toBe("20131312955-09-T001-1.zip");
		expect(body.archivo?.arcGreZip).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(body.archivo?.hashZip).toMatch(/^[a-f0-9]{64}$/);
	});

	test("hashZip is sha256 of the zip bytes (matches arcGreZip decoded)", async () => {
		let captured: { archivo?: { arcGreZip?: string; hashZip?: string } } = {};
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			captured = JSON.parse(String(init?.body || "{}"));
			return new Response(JSON.stringify({ numTicket: "T1" }), { status: 200 });
		});
		await enviarGre({ filename: "20131312955-09-T001-99", signedXml: "<x/>" }, creds);
		const zipBytes = Buffer.from(captured.archivo!.arcGreZip!, "base64");
		const expectedHash = await import("crypto").then((c) => c.createHash("sha256").update(zipBytes).digest("hex"));
		expect(captured.archivo?.hashZip).toBe(expectedHash);
	});
});

describe("consultarGreTicket", () => {
	test("GETs /v1/contribuyente/gem/comprobantes/envios/{ticket}", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response(JSON.stringify({ numTicket: "T1", codRespuesta: "0001", desRespuesta: "Aceptado" }), { status: 200 });
		});
		const r = await consultarGreTicket("T1", creds);
		expect(seenUrl).toContain("/contribuyente/gem/comprobantes/envios/T1");
		expect(r.codRespuesta).toBe("0001");
	});
});

describe("pollGreTicket", () => {
	test("returns 'completed' when codRespuesta=0001", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ numTicket: "T1", codRespuesta: "0001", desRespuesta: "Aceptado" }), { status: 200 });
		});
		const r = await pollGreTicket({ creds, numTicket: "T1", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 1000 });
		expect(r.state).toBe("completed");
		expect(r.codRespuesta).toBe("0001");
	});

	test("returns 'rejected' when codRespuesta=0003", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ numTicket: "T1", codRespuesta: "0003", desRespuesta: "Rechazado" }), { status: 200 });
		});
		const r = await pollGreTicket({ creds, numTicket: "T1", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 1000 });
		expect(r.state).toBe("rejected");
	});

	test("returns 'still-processing' on timeout", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ numTicket: "T1", codRespuesta: "0098", desRespuesta: "En proceso" }), { status: 200 });
		});
		const r = await pollGreTicket({ creds, numTicket: "T1", initialDelayMs: 1, maxDelayMs: 1, timeoutMs: 30 });
		expect(r.state).toBe("still-processing");
	});
});
