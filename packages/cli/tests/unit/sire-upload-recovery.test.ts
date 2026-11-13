import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearTokenCache } from "../../src/sunat-rest/oauth.ts";
import { COD_LIBRO, sireCredentials, sireUpload } from "../../src/sunat-rest/sire.ts";

const ORIGINAL_FETCH = global.fetch;
beforeEach(() => clearTokenCache());
afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

const creds = sireCredentials({
	clientId: "synthetic-id",
	clientSecret: "synthetic-secret",
	ruc: "20000000001",
	solUsuario: "MODDATOS",
	solPassword: "moddatos",
});

describe("SIRE upload recovery integration", () => {
	for (const codLibro of [COD_LIBRO.rvie, COD_LIBRO.rce]) {
		test(`forwards recovery options and progress for book ${codLibro}`, async () => {
			const methods: string[] = [];
			const hints: (string | undefined)[] = [];
			let patches = 0;
			global.fetch = mock(async (_url, init) => {
				if (String(_url).includes("token")) return Response.json({ access_token: "synthetic-token", expires_in: 3600 });
				methods.push(init?.method ?? "");
				expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-token");
				if (init?.method === "POST")
					return new Response(null, { status: 201, headers: { Location: "/upload/20240100000001" } });
				if (init?.method === "HEAD")
					return new Response(null, { headers: { "Upload-Offset": "2", "Upload-Length": "4" } });
				if (++patches === 1) return new Response(null, { status: 503 });
				expect(new Headers(init?.headers).get("Upload-Offset")).toBe("2");
				expect(Buffer.from(init?.body as Uint8Array).toString()).toBe("cd");
				return new Response(null, { status: 204, headers: { "Upload-Offset": "4" } });
			});
			const result = await sireUpload(
				{
					kind: "reemplazoPropuesta",
					codLibro,
					perTributario: "202404",
					filename: "synthetic.zip",
					data: Buffer.from("abcd"),
					maxAttempts: 2,
					retryDelayMs: 0,
					uploadTimeoutMs: 1000,
					onProgress: (_n, _total, hint) => hints.push(hint),
				},
				creds,
			);
			expect(result.bytesSent).toBe(4);
			expect(hints).toContain("resumed from 2 bytes");
			expect(methods).toEqual(["POST", "PATCH", "HEAD", "PATCH"]);
		});
	}

	test("forwards a disabled retry budget", async () => {
		const methods: string[] = [];
		global.fetch = mock(async (_url, init) => {
			if (String(_url).includes("token")) return Response.json({ access_token: "synthetic-token", expires_in: 3600 });
			methods.push(init?.method ?? "");
			return init?.method === "POST"
				? new Response(null, { status: 201, headers: { Location: "/upload/1" } })
				: new Response(null, { status: 503 });
		});
		await expect(
			sireUpload(
				{
					kind: "importarPropuestaCp",
					codLibro: COD_LIBRO.rvie,
					perTributario: "202404",
					filename: "synthetic.zip",
					data: Buffer.alloc(4),
					maxAttempts: 1,
				},
				creds,
			),
		).rejects.toThrow(/attempts exhausted/);
		expect(methods).toEqual(["POST", "PATCH"]);
	});
});
