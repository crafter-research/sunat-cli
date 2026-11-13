import { afterEach, describe, expect, mock, test } from "bun:test";
import { tusUpload } from "../../src/sunat-rest/tus.ts";

const ORIGINAL_FETCH = global.fetch;
afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
});

const options = {
	endpoint: "https://example.test/upload",
	data: Buffer.from("abcdef"),
	metadata: {},
	bearerToken: "synthetic-token",
	retryDelayMs: 0,
};
const created = () => new Response(null, { status: 201, headers: { Location: "/upload/1" } });
const head = (offset: string, length = "6") =>
	new Response(null, { headers: { "Upload-Offset": offset, "Upload-Length": length } });
const patched = (offset: number) => new Response(null, { status: 204, headers: { "Upload-Offset": String(offset) } });

describe("TUS recovery boundaries", () => {
	for (const failure of ["503", "ECONNRESET", "ETIMEDOUT"]) {
		test(`resumes a partially accepted chunk after ${failure}`, async () => {
			const methods: string[] = [];
			const offsets: string[] = [];
			const bodies: string[] = [];
			const hints: (string | undefined)[] = [];
			global.fetch = mock(async (_url, init) => {
				methods.push(init?.method ?? "");
				if (init?.method === "POST") return new Response(null, { status: 201, headers: { Location: "/u" } });
				if (init?.method === "HEAD")
					return new Response(null, { headers: { "Upload-Offset": "2", "Upload-Length": "6" } });
				offsets.push(new Headers(init?.headers).get("Upload-Offset") ?? "");
				bodies.push(Buffer.from(init?.body as Uint8Array).toString());
				if (offsets.length === 1) {
					if (failure === "503") return new Response(null, { status: 503 });
					throw new TypeError("fetch failed", {
						cause: Object.assign(new Error("connection lost"), { code: failure }),
					});
				}
				return new Response(null, { status: 204, headers: { "Upload-Offset": offsets.length === 2 ? "4" : "6" } });
			});
			const result = await tusUpload({
				endpoint: "https://x/upload",
				data: Buffer.from("abcdef"),
				metadata: {},
				bearerToken: "tk",
				chunkSize: 4,
				retryDelayMs: 0,
				onProgress: (_n, _total, hint) => hints.push(hint),
			});
			expect(result.bytesSent).toBe(6);
			expect(methods).toEqual(["POST", "PATCH", "HEAD", "PATCH", "PATCH"]);
			expect(offsets).toEqual(["0", "2", "4"]);
			expect(bodies).toEqual(["abcd", "cd", "ef"]);
			expect(hints).toContain("resumed from 2 bytes");
		});
	}

	test("stops after the default three attempts without creating another upload", async () => {
		const methods: string[] = [];
		global.fetch = mock(async (_url, init) => {
			methods.push(init?.method ?? "");
			if (init?.method === "POST") return new Response(null, { status: 201, headers: { Location: "/u" } });
			if (init?.method === "HEAD") return new Response(null, { headers: { "Upload-Offset": "0" } });
			return new Response(null, { status: 503 });
		});
		await expect(
			tusUpload({ endpoint: "https://x", data: Buffer.alloc(6), metadata: {}, bearerToken: "tk", retryDelayMs: 0 }),
		).rejects.toThrow(/attempt.*exhausted/i);
		expect(methods).toEqual(["POST", "PATCH", "HEAD", "PATCH", "HEAD", "PATCH"]);
	});

	test("recognizes a completed upload when the final PATCH response was lost", async () => {
		const methods: string[] = [];
		global.fetch = mock(async (_url, init) => {
			methods.push(init?.method ?? "");
			if (init?.method === "POST") return created();
			if (init?.method === "HEAD") return head("6");
			throw Object.assign(new Error("lost response"), { code: "ECONNRESET" });
		});
		expect((await tusUpload(options)).bytesSent).toBe(6);
		expect(methods).toEqual(["POST", "PATCH", "HEAD"]);
	});

	for (const status of [400, 401, 403, 404, 409, 410, 422]) {
		test(`does not retry permanent HTTP ${status}`, async () => {
			const methods: string[] = [];
			global.fetch = mock(async (_url, init) => {
				methods.push(init?.method ?? "");
				return init?.method === "POST" ? created() : new Response(null, { status });
			});
			await expect(tusUpload(options)).rejects.toThrow(`HTTP ${status}`);
			expect(methods).toEqual(["POST", "PATCH"]);
		});
	}

	test("never retries upload creation after an ambiguous network error", async () => {
		let calls = 0;
		global.fetch = mock(async () => {
			calls++;
			throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
		});
		await expect(tusUpload(options)).rejects.toThrow("reset");
		expect(calls).toBe(1);
	});

	test("retries HEAD before sending more bytes if recovery itself fails", async () => {
		const methods: string[] = [];
		let heads = 0;
		let patches = 0;
		global.fetch = mock(async (_url, init) => {
			methods.push(init?.method ?? "");
			if (init?.method === "POST") return created();
			if (init?.method === "HEAD") return ++heads === 1 ? new Response(null, { status: 503 }) : head("2");
			return ++patches === 1 ? new Response(null, { status: 500 }) : patched(6);
		});
		expect((await tusUpload(options)).bytesSent).toBe(6);
		expect(methods).toEqual(["POST", "PATCH", "HEAD", "HEAD", "PATCH"]);
	});

	test("counts repeated failed HEAD requests against the same budget", async () => {
		const methods: string[] = [];
		global.fetch = mock(async (_url, init) => {
			methods.push(init?.method ?? "");
			return init?.method === "POST" ? created() : new Response(null, { status: 503 });
		});
		await expect(tusUpload(options)).rejects.toThrow(/attempts exhausted/);
		expect(methods).toEqual(["POST", "PATCH", "HEAD", "HEAD"]);
	});

	test("does not reset the retry budget on partial progress within a chunk", async () => {
		let patches = 0;
		global.fetch = mock(async (_url, init) => {
			if (init?.method === "POST") return created();
			if (init?.method === "HEAD") return head(String(patches));
			patches++;
			return new Response(null, { status: 503 });
		});
		await expect(tusUpload(options)).rejects.toThrow(/attempts exhausted/);
		expect(patches).toBe(3);
	});

	for (const offset of ["-1", "NaN", "1x", "1.5", "9007199254740992", "7", ""]) {
		test(`rejects an invalid or out-of-range HEAD offset: ${JSON.stringify(offset)}`, async () => {
			let patches = 0;
			global.fetch = mock(async (_url, init) => {
				if (init?.method === "POST") return created();
				if (init?.method === "HEAD") return head(offset);
				patches++;
				return new Response(null, { status: 503 });
			});
			await expect(tusUpload(options)).rejects.toThrow(/invalid Upload-Offset|inconsistent upload/);
			expect(patches).toBe(1);
		});
	}

	test("rejects a different upload length reported by HEAD", async () => {
		global.fetch = mock(async (_url, init) => {
			if (init?.method === "POST") return created();
			return init?.method === "HEAD" ? head("2", "7") : new Response(null, { status: 503 });
		});
		await expect(tusUpload(options)).rejects.toThrow(/inconsistent upload/);
	});

	test("rejects a regressed HEAD offset after a successful chunk", async () => {
		let patches = 0;
		global.fetch = mock(async (_url, init) => {
			if (init?.method === "POST") return created();
			if (init?.method === "HEAD") return head("2");
			return ++patches === 1 ? patched(3) : new Response(null, { status: 503 });
		});
		await expect(tusUpload({ ...options, chunkSize: 3 })).rejects.toThrow(/inconsistent upload/);
		expect(patches).toBe(2);
	});

	for (const offset of [0, 7]) {
		test(`rejects a successful PATCH with unexpected offset ${offset}`, async () => {
			global.fetch = mock(async (_url, init) => (init?.method === "POST" ? created() : patched(offset)));
			await expect(tusUpload(options)).rejects.toThrow(/unexpected Upload-Offset/);
		});
	}

	test("resets the attempt budget only after a complete chunk", async () => {
		let offset = 0;
		let patches = 0;
		global.fetch = mock(async (_url, init) => {
			if (init?.method === "POST") return created();
			if (init?.method === "HEAD") return head(String(offset));
			if (++patches % 2 === 1) return new Response(null, { status: 503 });
			const body = init?.body as Uint8Array;
			offset += body.byteLength;
			return patched(offset);
		});
		expect((await tusUpload({ ...options, chunkSize: 2, maxAttempts: 2 })).bytesSent).toBe(6);
		expect(patches).toBe(6);
	});

	test("maxAttempts=1 disables recovery", async () => {
		const methods: string[] = [];
		global.fetch = mock(async (_url, init) => {
			methods.push(init?.method ?? "");
			return init?.method === "POST" ? created() : new Response(null, { status: 503 });
		});
		await expect(tusUpload({ ...options, maxAttempts: 1 })).rejects.toThrow(/attempts exhausted/);
		expect(methods).toEqual(["POST", "PATCH"]);
	});

	for (const invalid of [
		{ chunkSize: 0 },
		{ chunkSize: -1 },
		{ maxAttempts: 0 },
		{ maxAttempts: 1.5 },
		{ maxAttempts: Number.NaN },
		{ uploadTimeoutMs: 0 },
		{ uploadTimeoutMs: 2 ** 32 },
		{ retryDelayMs: -1 },
	]) {
		test(`rejects invalid options before creating an upload: ${JSON.stringify(invalid)}`, async () => {
			let calls = 0;
			global.fetch = mock(async () => {
				calls++;
				return created();
			});
			await expect(tusUpload({ ...options, ...invalid })).rejects.toThrow(/TUS invalid/);
			expect(calls).toBe(0);
		});
	}

	for (const stalledMethod of ["POST", "PATCH", "HEAD"]) {
		test(`aborts a stalled ${stalledMethod} at the total upload deadline`, async () => {
			global.fetch = mock(async (_url, init) => {
				if (init?.method === stalledMethod)
					return new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
					});
				return init?.method === "POST" ? created() : new Response(null, { status: 503 });
			});
			await expect(tusUpload({ ...options, uploadTimeoutMs: 30 })).rejects.toThrow("TUS upload timed out after 30 ms");
		});
	}

	test("the total deadline also interrupts retry backoff", async () => {
		const methods: string[] = [];
		global.fetch = mock(async (_url, init) => {
			methods.push(init?.method ?? "");
			return init?.method === "POST" ? created() : new Response(null, { status: 503 });
		});
		await expect(tusUpload({ ...options, uploadTimeoutMs: 30, retryDelayMs: 5000 })).rejects.toThrow(/timed out/);
		expect(methods).toEqual(["POST", "PATCH"]);
	});

	test("a 500 MiB upload survives a network blip without restarting", async () => {
		const data = Buffer.alloc(500 * 1024 * 1024);
		let offset = 0;
		let interrupted = false;
		let creations = 0;
		global.fetch = mock(async (_url, init) => {
			if (init?.method === "POST") {
				creations++;
				return created();
			}
			if (init?.method === "HEAD") return head(String(offset), String(data.byteLength));
			expect(new Headers(init?.headers).get("Upload-Offset")).toBe(String(offset));
			const body = init?.body as Uint8Array;
			const length = body.byteLength;
			if (!interrupted && offset >= 16 * 1024 * 1024) {
				interrupted = true;
				offset += Math.floor(length / 2);
				throw Object.assign(new Error("synthetic connection reset"), { code: "ECONNRESET" });
			}
			offset += length;
			return patched(offset);
		});
		expect((await tusUpload({ ...options, data })).bytesSent).toBe(data.byteLength);
		expect(creations).toBe(1);
		expect(interrupted).toBe(true);
	});
});
