import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { validarComprobante } from "../../src/sunat-rest/consulta-cpe.ts";
import { clearTokenCache } from "../../src/sunat-rest/oauth.ts";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => clearTokenCache());
afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
	global.fetch = mock(async (url, init) => impl(String(url), init as RequestInit));
}

const creds = { clientId: "cid", clientSecret: "csec" };

describe("validarComprobante", () => {
	test("posts to /contribuyentes/{ruc}/validarcomprobante with correct body", async () => {
		const seen: { url?: string; body?: string } = {};
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			seen.url = url;
			seen.body = String(init?.body || "");
			return new Response(
				JSON.stringify({
					success: true,
					message: "OK",
					data: { estadoCp: "0001", estadoRuc: "00", condDomiRuc: "00" },
				}),
				{ status: 200 },
			);
		});
		const result = await validarComprobante(
			{
				rucConsultante: "20111111111",
				rucEmisor: "20222222222",
				tipoComprobante: "01",
				serie: "F001",
				numero: 1234,
				fechaEmision: "2026-04-29",
				monto: 118,
			},
			creds,
		);
		expect(seen.url).toContain("/contribuyente/contribuyentes/20111111111/validarcomprobante");
		const body = JSON.parse(seen.body || "{}");
		expect(body.numRuc).toBe("20222222222");
		expect(body.codComp).toBe("01");
		expect(body.numeroSerie).toBe("F001");
		expect(body.numero).toBe("1234");
		expect(body.fechaEmision).toBe("29/04/2026"); // ISO converted to DD/MM/YYYY
		expect(body.monto).toBe("118.00");
		expect(result.exists).toBe(true);
		expect(result.estadoCpDesc).toBe("Aceptado");
		expect(result.estadoRucDesc).toBe("Activo");
		expect(result.condDomiRucDesc).toBe("Habido");
	});

	test("converts already-DD/MM/YYYY date as-is", async () => {
		let body: Record<string, string> = {};
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			body = JSON.parse(String(init?.body || "{}"));
			return new Response(JSON.stringify({ success: true, message: "OK", data: { estadoCp: "0001", estadoRuc: "00", condDomiRuc: "00" } }), { status: 200 });
		});
		await validarComprobante(
			{ rucConsultante: "20111111111", rucEmisor: "20222222222", tipoComprobante: "01", serie: "F001", numero: 1, fechaEmision: "29/04/2026" },
			creds,
		);
		expect(body.fechaEmision).toBe("29/04/2026");
	});

	test("omits monto when not provided", async () => {
		let body: Record<string, string> = {};
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			body = JSON.parse(String(init?.body || "{}"));
			return new Response(JSON.stringify({ success: true, message: "OK", data: { estadoCp: "0001", estadoRuc: "00", condDomiRuc: "00" } }), { status: 200 });
		});
		await validarComprobante(
			{ rucConsultante: "20111111111", rucEmisor: "20222222222", tipoComprobante: "01", serie: "F001", numero: 1, fechaEmision: "2026-04-29" },
			creds,
		);
		expect("monto" in body).toBe(false);
	});

	test("maps unknown estado codes to the raw code", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(
				JSON.stringify({ success: true, message: "OK", data: { estadoCp: "9999", estadoRuc: "ZZ", condDomiRuc: "QQ" } }),
				{ status: 200 },
			);
		});
		const r = await validarComprobante(
			{ rucConsultante: "20111111111", rucEmisor: "20222222222", tipoComprobante: "01", serie: "F001", numero: 1, fechaEmision: "2026-04-29" },
			creds,
		);
		expect(r.estadoCpDesc).toBe("9999");
		expect(r.estadoRucDesc).toBe("ZZ");
		expect(r.condDomiRucDesc).toBe("QQ");
	});

	test("returns exists=false when SUNAT response has no data", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			return new Response(JSON.stringify({ success: false, message: "NOT FOUND", errorCode: "404" }), { status: 200 });
		});
		const r = await validarComprobante(
			{ rucConsultante: "20111111111", rucEmisor: "20222222222", tipoComprobante: "01", serie: "F001", numero: 9, fechaEmision: "2026-04-29" },
			creds,
		);
		expect(r.exists).toBe(false);
	});

	test("formats monto to exactly 2 decimals", async () => {
		let body: Record<string, string> = {};
		mockFetch(async (url, init) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
			body = JSON.parse(String(init?.body || "{}"));
			return new Response(JSON.stringify({ success: true, message: "OK", data: { estadoCp: "0001", estadoRuc: "00", condDomiRuc: "00" } }), { status: 200 });
		});
		await validarComprobante(
			{ rucConsultante: "20111111111", rucEmisor: "20222222222", tipoComprobante: "01", serie: "F001", numero: 1, fechaEmision: "2026-04-29", monto: 118 },
			creds,
		);
		expect(body.monto).toBe("118.00");
	});
});
