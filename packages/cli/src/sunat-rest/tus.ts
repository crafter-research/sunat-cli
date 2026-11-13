/**
 * TUS.IO 1.0.0 resumable upload client — minimal subset SUNAT SIRE needs.
 *
 * Protocol spec: https://tus.io/protocols/resumable-upload
 *
 * SUNAT's note: "los servicios API REST que impliquen el desarrollo de un
 * cliente TUS deben ser desarrollados en el lenguaje JAVA". This is an
 * implementation suggestion (SUNAT only ships Java samples), NOT a protocol
 * requirement. The TUS spec is HTTP-based and language-agnostic.
 *
 * What we implement (creation extension only):
 *  - POST {url} with Upload-Length + Upload-Metadata + Tus-Resumable: 1.0.0
 *    → 201 Created with Location header (the upload URL)
 *  - PATCH {locationUrl} with Upload-Offset + Content-Type: application/offset+octet-stream
 *    → 204 No Content + new Upload-Offset
 *  - HEAD {locationUrl} to read current offset (used for retry/resume)
 *
 * What we DON'T implement (not needed for SUNAT SIRE):
 *  - Termination extension (DELETE)
 *  - Concatenation extension (parallel uploads)
 *  - Expiration extension (cleanup of stale uploads)
 *  - Checksum extension
 */

import { setTimeout as delay } from "node:timers/promises";

export const TUS_VERSION = "1.0.0";

class TusHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

function isTransient(error: unknown): boolean {
	if (error instanceof TusHttpError) return error.status >= 500 && error.status <= 599;
	if (!(error instanceof Error)) return false;
	const code = (error as Error & { code?: string }).code;
	return (
		[
			"ECONNRESET",
			"ETIMEDOUT",
			"ECONNREFUSED",
			"EPIPE",
			"EAI_AGAIN",
			"UND_ERR_SOCKET",
			"UND_ERR_CONNECT_TIMEOUT",
			"UND_ERR_HEADERS_TIMEOUT",
			"UND_ERR_BODY_TIMEOUT",
		].includes(code ?? "") ||
		(error instanceof TypeError && error.message === "fetch failed") ||
		(error.cause !== undefined && isTransient(error.cause))
	);
}

function readOffset(value: string | null, header: string): number {
	if (value === null) throw new Error(`TUS response missing ${header}`);
	const number = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new Error(`TUS response invalid ${header}`);
	return number;
}

export interface TusMetadata {
	[key: string]: string;
}

/**
 * SUNAT-style metadata: all values are base64-encoded UTF-8.
 * The TUS spec format is "key1 base64Value1,key2 base64Value2,..." — that's what
 * SUNAT samples (and the spec) use.
 */
export function encodeMetadata(meta: TusMetadata): string {
	const pairs: string[] = [];
	for (const [key, value] of Object.entries(meta)) {
		const b64 = Buffer.from(value, "utf-8").toString("base64");
		pairs.push(`${key} ${b64}`);
	}
	return pairs.join(",");
}

export interface TusCreateOpts {
	endpoint: string; // e.g. https://api-sire.sunat.gob.pe/v1/.../upload
	uploadLength: number;
	metadata: TusMetadata;
	bearerToken: string;
	signal?: AbortSignal;
}

export interface TusCreateResult {
	uploadUrl: string; // The Location header from the POST response (used for PATCH)
}

export async function tusCreate(opts: TusCreateOpts): Promise<TusCreateResult> {
	const resp = await fetch(opts.endpoint, {
		method: "POST",
		signal: opts.signal,
		headers: {
			"Tus-Resumable": TUS_VERSION,
			"Upload-Length": String(opts.uploadLength),
			"Upload-Metadata": encodeMetadata(opts.metadata),
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Bearer ${opts.bearerToken}`,
		},
	});

	if (resp.status !== 201) {
		throw new Error(`TUS create failed: HTTP ${resp.status}`);
	}

	const location = resp.headers.get("Location") || resp.headers.get("location");
	if (!location) {
		throw new Error("TUS create response missing Location header");
	}

	// Location may be relative; resolve against the endpoint.
	const url = new URL(location, opts.endpoint).toString();
	return { uploadUrl: url };
}

export interface TusHeadResult {
	uploadOffset: number;
	uploadLength?: number;
}

export async function tusHead(uploadUrl: string, bearerToken: string, signal?: AbortSignal): Promise<TusHeadResult> {
	const resp = await fetch(uploadUrl, {
		method: "HEAD",
		signal,
		headers: {
			"Tus-Resumable": TUS_VERSION,
			Authorization: `Bearer ${bearerToken}`,
		},
	});
	if (!resp.ok && resp.status !== 200) {
		throw new TusHttpError(`TUS head failed: HTTP ${resp.status}`, resp.status);
	}
	const offsetHeader = resp.headers.get("Upload-Offset");
	const lengthHeader = resp.headers.get("Upload-Length");
	return {
		uploadOffset: readOffset(offsetHeader, "Upload-Offset"),
		uploadLength: lengthHeader === null ? undefined : readOffset(lengthHeader, "Upload-Length"),
	};
}

export interface TusPatchOpts {
	uploadUrl: string;
	chunk: Buffer;
	offset: number;
	bearerToken: string;
	signal?: AbortSignal;
}

export interface TusPatchResult {
	newOffset: number;
}

export async function tusPatch(opts: TusPatchOpts): Promise<TusPatchResult> {
	// Web fetch wants BodyInit; cast Buffer → Uint8Array for type compatibility.
	const body = new Uint8Array(opts.chunk.buffer, opts.chunk.byteOffset, opts.chunk.byteLength);
	const resp = await fetch(opts.uploadUrl, {
		method: "PATCH",
		signal: opts.signal,
		headers: {
			"Tus-Resumable": TUS_VERSION,
			"Upload-Offset": String(opts.offset),
			"Content-Type": "application/offset+octet-stream",
			"Content-Length": String(opts.chunk.byteLength),
			Authorization: `Bearer ${opts.bearerToken}`,
		},
		body,
	});
	if (resp.status !== 204) {
		throw new TusHttpError(`TUS patch failed at offset ${opts.offset}: HTTP ${resp.status}`, resp.status);
	}
	const newOffsetHeader = resp.headers.get("Upload-Offset");
	const newOffset = readOffset(newOffsetHeader, "Upload-Offset");
	if (newOffset !== opts.offset + opts.chunk.byteLength) throw new Error("TUS patch returned unexpected Upload-Offset");
	return { newOffset };
}

export interface TusUploadOpts {
	endpoint: string;
	data: Buffer;
	metadata: TusMetadata;
	bearerToken: string;
	chunkSize?: number; // default 8 MB
	maxAttempts?: number;
	uploadTimeoutMs?: number;
	retryDelayMs?: number;
	onProgress?: (uploaded: number, total: number, hint?: string) => void;
}

/**
 * High-level: create + chunked PATCH until done.
 * Returns the uploadUrl (useful for retry / debugging) and total bytes sent.
 */
export async function tusUpload(opts: TusUploadOpts): Promise<{ uploadUrl: string; bytesSent: number }> {
	const total = opts.data.byteLength;
	const chunkSize = opts.chunkSize ?? 8 * 1024 * 1024;
	const maxAttempts = opts.maxAttempts ?? 3;
	const uploadTimeoutMs = opts.uploadTimeoutMs ?? 600_000;
	const retryDelayMs = opts.retryDelayMs ?? 1000;
	for (const [name, value] of Object.entries({ chunkSize, maxAttempts, uploadTimeoutMs, retryDelayMs })) {
		if (
			!Number.isSafeInteger(value) ||
			value < (name === "retryDelayMs" ? 0 : 1) ||
			(name === "uploadTimeoutMs" && value > 2_147_483_647)
		) {
			throw new Error(`TUS invalid ${name}`);
		}
	}
	const signal = AbortSignal.timeout(uploadTimeoutMs);

	try {
		const { uploadUrl } = await tusCreate({
			endpoint: opts.endpoint,
			uploadLength: total,
			metadata: opts.metadata,
			bearerToken: opts.bearerToken,
			signal,
		});

		let offset = 0;
		let end = Math.min(chunkSize, total);
		let failures = 0;
		while (offset < total) {
			signal.throwIfAborted();
			try {
				if (failures > 0) {
					const head = await tusHead(uploadUrl, opts.bearerToken, signal);
					if (
						head.uploadOffset < offset ||
						head.uploadOffset > end ||
						(head.uploadLength !== undefined && head.uploadLength !== total)
					) {
						throw new Error("TUS recovery returned inconsistent upload offset or length");
					}
					offset = head.uploadOffset;
					opts.onProgress?.(offset, total, `resumed from ${offset} bytes`);
				}
				if (offset < end) {
					const { newOffset } = await tusPatch({
						uploadUrl,
						chunk: opts.data.subarray(offset, end),
						offset,
						bearerToken: opts.bearerToken,
						signal,
					});
					offset = newOffset;
					opts.onProgress?.(offset, total);
				}
			} catch (error) {
				signal.throwIfAborted();
				if (!isTransient(error)) throw error;
				if (++failures >= maxAttempts)
					throw new Error(`TUS attempts exhausted (${maxAttempts}) at offset ${offset}`, { cause: error });
				await delay(Math.min(retryDelayMs * 2 ** (failures - 1), 30_000), undefined, { signal });
				continue;
			}
			failures = 0;
			end = Math.min(offset + chunkSize, total);
		}

		return { uploadUrl, bytesSent: offset };
	} catch (error) {
		if (signal.aborted) throw new Error(`TUS upload timed out after ${uploadTimeoutMs} ms`);
		throw error;
	}
}
