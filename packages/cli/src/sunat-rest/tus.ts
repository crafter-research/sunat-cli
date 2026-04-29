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

export const TUS_VERSION = "1.0.0";

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
}

export interface TusCreateResult {
	uploadUrl: string; // The Location header from the POST response (used for PATCH)
}

export async function tusCreate(opts: TusCreateOpts): Promise<TusCreateResult> {
	const resp = await fetch(opts.endpoint, {
		method: "POST",
		headers: {
			"Tus-Resumable": TUS_VERSION,
			"Upload-Length": String(opts.uploadLength),
			"Upload-Metadata": encodeMetadata(opts.metadata),
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Bearer ${opts.bearerToken}`,
		},
	});

	if (resp.status !== 201) {
		const text = await resp.text();
		throw new Error(`TUS create failed: HTTP ${resp.status}: ${text.slice(0, 500)}`);
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

export async function tusHead(uploadUrl: string, bearerToken: string): Promise<TusHeadResult> {
	const resp = await fetch(uploadUrl, {
		method: "HEAD",
		headers: {
			"Tus-Resumable": TUS_VERSION,
			Authorization: `Bearer ${bearerToken}`,
		},
	});
	if (!resp.ok && resp.status !== 200) {
		throw new Error(`TUS head failed: HTTP ${resp.status}`);
	}
	const offsetHeader = resp.headers.get("Upload-Offset");
	const lengthHeader = resp.headers.get("Upload-Length");
	if (!offsetHeader) throw new Error("TUS head response missing Upload-Offset");
	return {
		uploadOffset: Number.parseInt(offsetHeader, 10),
		uploadLength: lengthHeader ? Number.parseInt(lengthHeader, 10) : undefined,
	};
}

export interface TusPatchOpts {
	uploadUrl: string;
	chunk: Buffer;
	offset: number;
	bearerToken: string;
}

export interface TusPatchResult {
	newOffset: number;
}

export async function tusPatch(opts: TusPatchOpts): Promise<TusPatchResult> {
	// Web fetch wants BodyInit; cast Buffer → Uint8Array for type compatibility.
	const body = new Uint8Array(opts.chunk.buffer, opts.chunk.byteOffset, opts.chunk.byteLength);
	const resp = await fetch(opts.uploadUrl, {
		method: "PATCH",
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
		const text = await resp.text();
		throw new Error(`TUS patch failed at offset ${opts.offset}: HTTP ${resp.status}: ${text.slice(0, 500)}`);
	}
	const newOffsetHeader = resp.headers.get("Upload-Offset");
	if (!newOffsetHeader) throw new Error("TUS patch response missing Upload-Offset");
	return { newOffset: Number.parseInt(newOffsetHeader, 10) };
}

export interface TusUploadOpts {
	endpoint: string;
	data: Buffer;
	metadata: TusMetadata;
	bearerToken: string;
	chunkSize?: number; // default 8 MB
	onProgress?: (uploaded: number, total: number) => void;
}

/**
 * High-level: create + chunked PATCH until done.
 * Returns the uploadUrl (useful for retry / debugging) and total bytes sent.
 */
export async function tusUpload(opts: TusUploadOpts): Promise<{ uploadUrl: string; bytesSent: number }> {
	const total = opts.data.byteLength;
	const chunkSize = opts.chunkSize ?? 8 * 1024 * 1024;

	const { uploadUrl } = await tusCreate({
		endpoint: opts.endpoint,
		uploadLength: total,
		metadata: opts.metadata,
		bearerToken: opts.bearerToken,
	});

	let offset = 0;
	while (offset < total) {
		const end = Math.min(offset + chunkSize, total);
		const chunk = opts.data.subarray(offset, end);
		const { newOffset } = await tusPatch({
			uploadUrl,
			chunk,
			offset,
			bearerToken: opts.bearerToken,
		});
		offset = newOffset;
		opts.onProgress?.(offset, total);
	}

	return { uploadUrl, bytesSent: offset };
}
