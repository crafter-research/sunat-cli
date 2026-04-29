import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TUS_VERSION, encodeMetadata, tusCreate, tusHead, tusPatch, tusUpload } from "../../src/sunat-rest/tus.ts";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {});
afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
	global.fetch = mock(async (url, init) => impl(String(url), init as RequestInit));
}

describe("encodeMetadata", () => {
	test("encodes single key as 'key base64'", () => {
		expect(encodeMetadata({ filename: "hola.zip" })).toBe(`filename ${Buffer.from("hola.zip").toString("base64")}`);
	});

	test("joins multiple pairs with comma per TUS spec", () => {
		const out = encodeMetadata({ filename: "a.zip", filetype: "application/zip" });
		expect(out).toContain("filename ");
		expect(out).toContain("filetype ");
		expect(out.split(",").length).toBe(2);
	});

	test("encodes UTF-8 multibyte chars (acentos)", () => {
		const value = "comprobantes-año.zip";
		const out = encodeMetadata({ filename: value });
		const decoded = Buffer.from(out.split(" ")[1], "base64").toString("utf-8");
		expect(decoded).toBe(value);
	});

	test("returns empty string when metadata is empty", () => {
		expect(encodeMetadata({})).toBe("");
	});
});

describe("TUS_VERSION", () => {
	test("targets 1.0.0", () => {
		expect(TUS_VERSION).toBe("1.0.0");
	});
});

describe("tusCreate", () => {
	test("POSTs Tus-Resumable + Upload-Length + Upload-Metadata + Bearer", async () => {
		let captured: { url?: string; method?: string; headers?: Record<string, string> } = {};
		mockFetch(async (url, init) => {
			captured = {
				url,
				method: init?.method,
				headers: init?.headers as Record<string, string>,
			};
			return new Response(null, { status: 201, headers: { Location: `${url}/upload-id-123` } });
		});

		const result = await tusCreate({
			endpoint: "https://api-sire.sunat.gob.pe/v1/upload",
			uploadLength: 12345,
			metadata: { filename: "test.zip", perTributario: "202404" },
			bearerToken: "tk",
		});

		expect(captured.method).toBe("POST");
		expect(captured.headers?.["Tus-Resumable"]).toBe("1.0.0");
		expect(captured.headers?.["Upload-Length"]).toBe("12345");
		expect(captured.headers?.["Upload-Metadata"]).toContain("filename ");
		expect(captured.headers?.Authorization).toBe("Bearer tk");
		expect(result.uploadUrl).toContain("/upload/upload-id-123");
	});

	test("resolves relative Location against the endpoint", async () => {
		mockFetch(async () => new Response(null, { status: 201, headers: { Location: "/v1/upload/relative-id" } }));
		const r = await tusCreate({
			endpoint: "https://api-sire.sunat.gob.pe/v1/foo/bar",
			uploadLength: 1,
			metadata: {},
			bearerToken: "tk",
		});
		expect(r.uploadUrl).toBe("https://api-sire.sunat.gob.pe/v1/upload/relative-id");
	});

	test("throws on non-201 status with body excerpt", async () => {
		mockFetch(async () => new Response("payload too large", { status: 413 }));
		expect(
			tusCreate({ endpoint: "https://x", uploadLength: 1, metadata: {}, bearerToken: "tk" }),
		).rejects.toThrow(/TUS create failed: HTTP 413/);
	});

	test("throws when Location header is missing", async () => {
		mockFetch(async () => new Response(null, { status: 201 }));
		expect(
			tusCreate({ endpoint: "https://x", uploadLength: 1, metadata: {}, bearerToken: "tk" }),
		).rejects.toThrow(/missing Location header/);
	});
});

describe("tusHead", () => {
	test("reads Upload-Offset", async () => {
		mockFetch(async () => new Response(null, { status: 200, headers: { "Upload-Offset": "1024", "Upload-Length": "4096" } }));
		const r = await tusHead("https://x/upload/123", "tk");
		expect(r.uploadOffset).toBe(1024);
		expect(r.uploadLength).toBe(4096);
	});

	test("throws when Upload-Offset missing", async () => {
		mockFetch(async () => new Response(null, { status: 200 }));
		expect(tusHead("https://x", "tk")).rejects.toThrow(/missing Upload-Offset/);
	});
});

describe("tusPatch", () => {
	test("PATCH with Upload-Offset + offset+octet-stream content-type", async () => {
		let captured: { method?: string; headers?: Record<string, string>; bodyLength?: number } = {};
		mockFetch(async (_url, init) => {
			const body = init?.body;
			captured = {
				method: init?.method,
				headers: init?.headers as Record<string, string>,
				bodyLength: body instanceof Uint8Array ? body.byteLength : 0,
			};
			return new Response(null, { status: 204, headers: { "Upload-Offset": "8192" } });
		});
		const chunk = Buffer.alloc(4096, "a");
		const r = await tusPatch({ uploadUrl: "https://x/upload/1", chunk, offset: 4096, bearerToken: "tk" });
		expect(captured.method).toBe("PATCH");
		expect(captured.headers?.["Upload-Offset"]).toBe("4096");
		expect(captured.headers?.["Content-Type"]).toBe("application/offset+octet-stream");
		expect(captured.headers?.["Tus-Resumable"]).toBe("1.0.0");
		expect(captured.bodyLength).toBe(4096);
		expect(r.newOffset).toBe(8192);
	});

	test("throws on non-204 status", async () => {
		mockFetch(async () => new Response("conflict", { status: 409 }));
		expect(
			tusPatch({ uploadUrl: "https://x", chunk: Buffer.alloc(1), offset: 0, bearerToken: "tk" }),
		).rejects.toThrow(/TUS patch failed at offset 0: HTTP 409/);
	});
});

describe("tusUpload (chunked end-to-end)", () => {
	test("uploads in 8MB chunks by default until done", async () => {
		const total = 20 * 1024 * 1024; // 20 MB
		const data = Buffer.alloc(total, 0x61);
		let offset = 0;
		const chunks: number[] = [];
		mockFetch(async (url, init) => {
			if (init?.method === "POST") {
				return new Response(null, { status: 201, headers: { Location: `${url}/u-1` } });
			}
			// PATCH
			const body = init?.body as Uint8Array;
			chunks.push(body.byteLength);
			offset += body.byteLength;
			return new Response(null, { status: 204, headers: { "Upload-Offset": String(offset) } });
		});
		const progressCalls: number[] = [];
		const r = await tusUpload({
			endpoint: "https://x/upload",
			data,
			metadata: { filename: "x.zip" },
			bearerToken: "tk",
			onProgress: (uploaded) => progressCalls.push(uploaded),
		});
		expect(r.bytesSent).toBe(total);
		expect(chunks.length).toBe(3); // 8 + 8 + 4 MB
		expect(chunks[0]).toBe(8 * 1024 * 1024);
		expect(chunks[1]).toBe(8 * 1024 * 1024);
		expect(chunks[2]).toBe(4 * 1024 * 1024);
		expect(progressCalls.length).toBe(3);
		expect(progressCalls[progressCalls.length - 1]).toBe(total);
	});

	test("respects --chunk-size when provided", async () => {
		const total = 10 * 1024;
		const data = Buffer.alloc(total, 0);
		const chunks: number[] = [];
		let offset = 0;
		mockFetch(async (url, init) => {
			if (init?.method === "POST") return new Response(null, { status: 201, headers: { Location: `${url}/u` } });
			const body = init?.body as Uint8Array;
			chunks.push(body.byteLength);
			offset += body.byteLength;
			return new Response(null, { status: 204, headers: { "Upload-Offset": String(offset) } });
		});
		await tusUpload({
			endpoint: "https://x/upload",
			data,
			metadata: {},
			bearerToken: "tk",
			chunkSize: 4096,
		});
		expect(chunks).toEqual([4096, 4096, 2048]);
	});
});
