import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { SCOPES, SUNAT_REST_BASES, callRestApi, clearTokenCache, getAccessToken } from "../../src/sunat-rest/oauth.ts";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
	clearTokenCache();
});

afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
	global.fetch = mock(async (url, init) => impl(String(url), init as RequestInit));
}

describe("SUNAT_REST_BASES + SCOPES", () => {
	test("security base is api-seguridad", () => {
		expect(SUNAT_REST_BASES.security).toContain("api-seguridad.sunat.gob.pe");
	});
	test("api base is api.sunat.gob.pe", () => {
		expect(SUNAT_REST_BASES.api).toContain("api.sunat.gob.pe");
	});
	test("contribuyente scope present", () => {
		expect(SCOPES.contribuyente).toContain("/contribuyente/contribuyentes");
	});
});

describe("getAccessToken", () => {
	test("posts client_credentials to token endpoint and returns access_token", async () => {
		let capturedUrl = "";
		let capturedBody = "";
		mockFetch(async (url, init) => {
			capturedUrl = url;
			capturedBody = String(init?.body || "");
			return new Response(JSON.stringify({ access_token: "tk-abc", token_type: "Bearer", expires_in: 3600 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		const token = await getAccessToken({ clientId: "cid", clientSecret: "csec" });
		expect(token).toBe("tk-abc");
		expect(capturedUrl).toContain("/clientesextranet/cid/oauth2/token/");
		expect(capturedBody).toContain("grant_type=client_credentials");
		expect(capturedBody).toContain("client_id=cid");
		expect(capturedBody).toContain("client_secret=csec");
		expect(capturedBody).toContain("scope=https");
	});

	test("caches token within expiry window (subsequent calls do not refetch)", async () => {
		let calls = 0;
		mockFetch(async () => {
			calls += 1;
			return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
		});
		await getAccessToken({ clientId: "cid", clientSecret: "csec" });
		await getAccessToken({ clientId: "cid", clientSecret: "csec" });
		await getAccessToken({ clientId: "cid", clientSecret: "csec" });
		expect(calls).toBe(1);
	});

	test("refetches when forced via clearTokenCache", async () => {
		let calls = 0;
		mockFetch(async () => {
			calls += 1;
			return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
		});
		await getAccessToken({ clientId: "cid", clientSecret: "csec" });
		clearTokenCache();
		await getAccessToken({ clientId: "cid", clientSecret: "csec" });
		expect(calls).toBe(2);
	});

	test("throws on non-200 with body excerpt", async () => {
		mockFetch(async () => new Response("invalid client", { status: 401 }));
		expect(getAccessToken({ clientId: "cid", clientSecret: "csec" })).rejects.toThrow(/SUNAT OAuth 401/);
	});

	test("throws on missing access_token in response", async () => {
		mockFetch(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 200 }));
		expect(getAccessToken({ clientId: "cid", clientSecret: "csec" })).rejects.toThrow(/access_token/);
	});

	test("uses custom scope when provided", async () => {
		let capturedBody = "";
		mockFetch(async (_url, init) => {
			capturedBody = String(init?.body || "");
			return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
		});
		await getAccessToken({ clientId: "cid", clientSecret: "csec", scope: "custom-scope" });
		expect(capturedBody).toContain("scope=custom-scope");
	});
});

describe("callRestApi", () => {
	test("attaches Bearer token + correct headers", async () => {
		const seen: { url?: string; auth?: string; ct?: string } = {};
		mockFetch(async (url, init) => {
			if (url.includes("/oauth2/token")) {
				return new Response(JSON.stringify({ access_token: "abc", expires_in: 3600 }), { status: 200 });
			}
			seen.url = url;
			const h = (init?.headers as Record<string, string>) || {};
			seen.auth = h.Authorization;
			seen.ct = h["Content-Type"];
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		const r = await callRestApi<{ ok: boolean }>({
			creds: { clientId: "cid", clientSecret: "csec" },
			path: "/contribuyente/test",
		});
		expect(r.ok).toBe(true);
		expect(seen.auth).toBe("Bearer abc");
		expect(seen.ct).toBe("application/json");
		expect(seen.url).toContain("/v1/contribuyente/test");
	});

	test("appends query params", async () => {
		let seenUrl = "";
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "x", expires_in: 3600 }), { status: 200 });
			seenUrl = url;
			return new Response("{}", { status: 200 });
		});
		await callRestApi({
			creds: { clientId: "c", clientSecret: "s" },
			path: "/contribuyente/x",
			query: { fecha: "2026-04-29", monto: 118 },
		});
		expect(seenUrl).toContain("fecha=2026-04-29");
		expect(seenUrl).toContain("monto=118");
	});

	test("retries once after 401 with fresh token", async () => {
		let attempts = 0;
		let tokenCalls = 0;
		mockFetch(async (url) => {
			if (url.includes("token")) {
				tokenCalls += 1;
				return new Response(JSON.stringify({ access_token: `tk-${tokenCalls}`, expires_in: 3600 }), { status: 200 });
			}
			attempts += 1;
			if (attempts === 1) return new Response("expired", { status: 401 });
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		const r = await callRestApi<{ ok: boolean }>({
			creds: { clientId: "c", clientSecret: "s" },
			path: "/contribuyente/x",
		});
		expect(r.ok).toBe(true);
		expect(attempts).toBe(2);
		expect(tokenCalls).toBe(2);
	});

	test("throws on non-401 error with status + path", async () => {
		mockFetch(async (url) => {
			if (url.includes("token")) return new Response(JSON.stringify({ access_token: "x", expires_in: 3600 }), { status: 200 });
			return new Response("not found", { status: 404 });
		});
		expect(
			callRestApi({ creds: { clientId: "c", clientSecret: "s" }, path: "/x" }),
		).rejects.toThrow(/SUNAT API 404 on \/x/);
	});
});
