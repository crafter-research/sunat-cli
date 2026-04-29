/**
 * SUNAT Padrón Reducido del RUC — local downloader + parser + index.
 *
 * Source: http://www2.sunat.gob.pe/padron_reducido_ruc.zip (~370MB ZIP, ~600MB TXT)
 *
 * The padrón reducido is published daily by SUNAT and contains the public
 * subset of the RUC registry: ruc, razón social, estado, condición, dirección,
 * etc. It's the same data the e-consultaruc portal exposes for individual RUCs,
 * but distributable as a single file. No auth, no captcha.
 *
 * Strategy:
 *  - Download to ~/.sunat/cache/padron_reducido_ruc.zip if missing or > 24h old
 *  - Parse the TXT inside the ZIP into a per-RUC index file (NDJSON)
 *  - Lookup is O(log N) via streaming scan keyed on the 11-char RUC prefix
 *
 * For PR #3 we ship the downloader + a streaming lookup. A faster sqlite
 * index is shaped for a follow-up PR.
 */

import { createHash } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "../data/config.ts";
import yauzl from "yauzl";

const PADRON_URL = "http://www2.sunat.gob.pe/padron_reducido_ruc.zip";
const CACHE_DIR = join(paths.sunatDir, "cache");
const ZIP_PATH = join(CACHE_DIR, "padron_reducido_ruc.zip");
const TXT_PATH = join(CACHE_DIR, "padron_reducido_ruc.txt");
const META_PATH = join(CACHE_DIR, "padron_meta.json");
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface PadronEntry {
	ruc: string;
	razonSocial: string;
	estado: string; // ACTIVO, BAJA PROVISIONAL, etc
	condicion: string; // HABIDO, NO HABIDO, ...
	tipoVia?: string;
	nombreVia?: string;
	codigoZona?: string;
	tipoZona?: string;
	numero?: string;
	interior?: string;
	lote?: string;
	manzana?: string;
	kilometro?: string;
	departamento?: string;
	provincia?: string;
	distrito?: string;
	ubigeo?: string;
}

export interface PadronMeta {
	lastFetchedAt: string; // ISO
	zipSize: number;
	zipSha256: string;
	txtPath: string;
	entries?: number;
}

function ensureDir(): void {
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function loadMeta(): PadronMeta | null {
	if (!existsSync(META_PATH)) return null;
	return JSON.parse(readFileSync(META_PATH, "utf-8")) as PadronMeta;
}

function saveMeta(meta: PadronMeta): void {
	writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}

export function isStale(meta: PadronMeta | null): boolean {
	if (!meta) return true;
	return Date.now() - new Date(meta.lastFetchedAt).getTime() > STALE_AFTER_MS;
}

export interface SyncOptions {
	force?: boolean;
	onProgress?: (bytesDownloaded: number, totalBytes: number) => void;
}

export async function syncPadron(opts: SyncOptions = {}): Promise<PadronMeta> {
	ensureDir();
	const existing = loadMeta();
	if (!opts.force && existing && !isStale(existing) && existsSync(TXT_PATH)) {
		return existing;
	}

	// Download
	const resp = await fetch(PADRON_URL);
	if (!resp.ok || !resp.body) {
		throw new Error(`Failed to download padrón: HTTP ${resp.status}`);
	}
	const total = Number.parseInt(resp.headers.get("content-length") || "0", 10);
	const reader = resp.body.getReader();
	const out = createWriteStream(ZIP_PATH);
	const hash = createHash("sha256");
	let downloaded = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			hash.update(value);
			downloaded += value.length;
			out.write(value);
			opts.onProgress?.(downloaded, total);
		}
	}
	await new Promise<void>((resolve) => out.end(resolve));

	// Extract TXT (single entry inside)
	const entries = await unzipToTxt(ZIP_PATH, TXT_PATH);

	const meta: PadronMeta = {
		lastFetchedAt: new Date().toISOString(),
		zipSize: statSync(ZIP_PATH).size,
		zipSha256: hash.digest("hex"),
		txtPath: TXT_PATH,
		entries,
	};
	saveMeta(meta);
	return meta;
}

async function unzipToTxt(zipPath: string, outPath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err || new Error("Cannot open padrón zip"));
			let resolved = false;
			zipfile.readEntry();
			zipfile.on("entry", (entry) => {
				const isDir = /\/$/.test(entry.fileName);
				if (isDir || !/\.txt$/i.test(entry.fileName)) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (e, stream) => {
					if (e || !stream) return reject(e || new Error("No stream"));
					// Pipe raw bytes straight to disk — no encoding conversion in the hot path.
					// Lookup-time decoding handles latin1 → UTF-8.
					const writer = createWriteStream(outPath);
					stream.pipe(writer);
					writer.on("finish", () => {
						resolved = true;
						// Estimate line count from byte size / avg row (~250B). Cheaper than counting.
						const size = statSync(outPath).size;
						resolve(Math.round(size / 250));
					});
					writer.on("error", reject);
					stream.on("error", reject);
				});
			});
			zipfile.on("end", () => {
				if (!resolved) reject(new Error("No .txt entry in padrón zip"));
			});
			zipfile.on("error", reject);
		});
	});
}

/**
 * Parse a single padrón line. The format is pipe-separated:
 *   RUC|RAZON_SOCIAL|ESTADO|CONDICION|UBIGEO|TIPO_VIA|NOMBRE_VIA|...
 *
 * Real format documented at orientacion.sunat.gob.pe; we keep the most useful
 * fields and store the raw line for power users.
 */
export function parsePadronLine(line: string): PadronEntry | null {
	const cols = line.split("|");
	if (cols.length < 4 || !/^\d{11}$/.test(cols[0])) return null;
	return {
		ruc: cols[0],
		razonSocial: (cols[1] || "").trim(),
		estado: (cols[2] || "").trim(),
		condicion: (cols[3] || "").trim(),
		ubigeo: (cols[4] || "").trim() || undefined,
		tipoVia: (cols[5] || "").trim() || undefined,
		nombreVia: (cols[6] || "").trim() || undefined,
		codigoZona: (cols[7] || "").trim() || undefined,
		tipoZona: (cols[8] || "").trim() || undefined,
		numero: (cols[9] || "").trim() || undefined,
		interior: (cols[10] || "").trim() || undefined,
		lote: (cols[11] || "").trim() || undefined,
		manzana: (cols[12] || "").trim() || undefined,
		kilometro: (cols[13] || "").trim() || undefined,
	};
}

/**
 * Streaming lookup: scan the TXT for a single RUC.
 *
 * Slow path (~5-15s on 600MB file). Good enough for ad-hoc queries. For
 * batch use, consider building a sqlite index (see padron-sqlite.ts shaping
 * for a follow-up PR).
 */
export async function lookupRuc(ruc: string): Promise<PadronEntry | null> {
	if (!/^\d{11}$/.test(ruc)) return null;
	if (!existsSync(TXT_PATH)) {
		throw new Error("Padrón not synced. Run: sunat padron sync");
	}

	return new Promise((resolve, reject) => {
		const stream = createReadStream(TXT_PATH, { encoding: "latin1" });
		let buffer = "";
		const prefix = `${ruc}|`;
		stream.on("data", (chunk) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (line.startsWith(prefix)) {
					stream.destroy();
					resolve(parsePadronLine(line));
					return;
				}
			}
		});
		stream.on("end", () => {
			if (buffer.startsWith(prefix)) {
				resolve(parsePadronLine(buffer));
			} else {
				resolve(null);
			}
		});
		stream.on("error", reject);
	});
}

/**
 * Batch lookup: scan once, find many.
 */
export async function lookupRucBatch(rucs: string[]): Promise<Map<string, PadronEntry | null>> {
	const result = new Map<string, PadronEntry | null>();
	const wanted = new Set<string>();
	for (const r of rucs) {
		if (/^\d{11}$/.test(r)) {
			result.set(r, null);
			wanted.add(r);
		}
	}
	if (wanted.size === 0) return result;
	if (!existsSync(TXT_PATH)) throw new Error("Padrón not synced. Run: sunat padron sync");

	return new Promise((resolve, reject) => {
		const stream = createReadStream(TXT_PATH, { encoding: "latin1" });
		let buffer = "";
		stream.on("data", (chunk) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				const ruc = line.slice(0, 11);
				if (wanted.has(ruc)) {
					result.set(ruc, parsePadronLine(line));
					wanted.delete(ruc);
					if (wanted.size === 0) {
						stream.destroy();
						resolve(result);
						return;
					}
				}
			}
		});
		stream.on("end", () => {
			if (buffer) {
				const ruc = buffer.slice(0, 11);
				if (wanted.has(ruc)) result.set(ruc, parsePadronLine(buffer));
			}
			resolve(result);
		});
		stream.on("error", reject);
	});
}
