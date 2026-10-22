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
 *  - Extract the TXT and optionally build a SQLite index with padron index
 *  - Lookup uses the current index, otherwise an O(N) streaming scan
 */

import { createHash, randomUUID } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import yauzl from "yauzl";
import { paths } from "../data/config.ts";

const PADRON_URL = "http://www2.sunat.gob.pe/padron_reducido_ruc.zip";
const CACHE_DIR = join(paths.sunatDir, "cache");
const ZIP_PATH = join(CACHE_DIR, "padron_reducido_ruc.zip");
const TXT_PATH = join(CACHE_DIR, "padron_reducido_ruc.txt");
const INDEX_PATH = join(CACHE_DIR, "padron.sqlite");
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

	// Invalidate before extraction: a failed extraction must never serve an old index.
	rmSync(INDEX_PATH, { force: true });
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
 * Used when no compatible SQLite index is available.
 */
export async function lookupRuc(ruc: string): Promise<PadronEntry | null> {
	if (!/^\d{11}$/.test(ruc)) return null;
	if (!existsSync(TXT_PATH)) {
		throw new Error("Padrón not synced. Run: sunat-cli padron sync");
	}

	const indexed = await readIndex([ruc]);
	if (indexed) return indexed.get(ruc) ?? null;

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
					const entry = parsePadronLine(line);
					if (!entry) continue;
					stream.destroy();
					resolve(entry);
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
	if (!existsSync(TXT_PATH)) throw new Error("Padrón not synced. Run: sunat-cli padron sync");
	const indexed = await readIndex([...wanted]);
	if (indexed) return indexed;

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
					const entry = parsePadronLine(line);
					if (!entry) continue;
					result.set(ruc, entry);
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

// Both runtimes ship SQLite; keep the Bun module dynamic so the published Node
// bundle can load without resolving bun:sqlite.
async function openDatabase(path: string, readonly = false) {
	if (typeof Bun !== "undefined") {
		const module = "bun:sqlite";
		const { Database } = await import(module);
		return new Database(path, readonly ? { readonly: true } : { create: true });
	}
	const { DatabaseSync } = await import("node:sqlite");
	return new DatabaseSync(path, { readOnly: readonly });
}

const INDEX_VERSION = "1";
const fields = [
	"ruc",
	"razonSocial",
	"estado",
	"condicion",
	"ubigeo",
	"tipoVia",
	"nombreVia",
	"codigoZona",
	"tipoZona",
	"numero",
	"interior",
	"lote",
	"manzana",
	"kilometro",
] as const;
const columns = [
	"ruc",
	"razon_social",
	"estado",
	"condicion",
	"ubigeo",
	"tipo_via",
	"nombre_via",
	"codigo_zona",
	"tipo_zona",
	"numero",
	"interior",
	"lote",
	"manzana",
	"kilometro",
];

function sourceIdentity(): string {
	const stat = statSync(TXT_PATH, { bigint: true });
	return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export function padronIndexStatus(): { present: boolean; size: number } {
	try {
		return { present: true, size: statSync(INDEX_PATH).size };
	} catch {
		return { present: false, size: 0 };
	}
}

/** Build beside the live index and publish only after a complete transaction. */
export async function indexPadron(): Promise<{ entries: number; size: number }> {
	if (!existsSync(TXT_PATH)) throw new Error("Padrón not synced. Run: sunat-cli padron sync");
	const identity = sourceIdentity();
	const temporary = `${INDEX_PATH}.${randomUUID()}.tmp`;
	let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
	try {
		db = await openDatabase(temporary);
		db.exec(
			"PRAGMA journal_mode=DELETE; CREATE TABLE metadata (version TEXT, source TEXT); CREATE TABLE padron (ruc TEXT PRIMARY KEY, razon_social TEXT, estado TEXT, condicion TEXT, ubigeo TEXT, tipo_via TEXT, nombre_via TEXT, codigo_zona TEXT, tipo_zona TEXT, numero TEXT, interior TEXT, lote TEXT, manzana TEXT, kilometro TEXT) WITHOUT ROWID; BEGIN",
		);
		const insert = db.prepare(`INSERT OR IGNORE INTO padron VALUES (${fields.map(() => "?").join(",")})`);
		const input = createReadStream(TXT_PATH, { encoding: "latin1" });
		const lines = createInterface({ input, crlfDelay: Infinity });
		try {
			for await (const line of lines) {
				const entry = parsePadronLine(line);
				if (entry) insert.run(...fields.map((key) => entry[key] ?? null));
			}
		} finally {
			lines.close();
			input.destroy();
		}
		if (sourceIdentity() !== identity) throw new Error("Padrón changed during indexing. Run: sunat-cli padron index");
		db.prepare("INSERT INTO metadata VALUES (?, ?)").run(INDEX_VERSION, identity);
		const entries = (db.prepare("SELECT count(*) AS count FROM padron").get() as { count: number }).count;
		db.exec("COMMIT");
		db.close();
		db = undefined;
		renameSync(temporary, INDEX_PATH);
		return { entries, size: statSync(INDEX_PATH).size };
	} finally {
		db?.close();
		rmSync(temporary, { force: true });
		rmSync(`${temporary}-journal`, { force: true });
	}
}

async function readIndex(rucs: string[]): Promise<Map<string, PadronEntry | null> | null> {
	if (!existsSync(INDEX_PATH)) return null;
	let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
	try {
		db = await openDatabase(INDEX_PATH, true);
		const meta = db.prepare("SELECT version, source FROM metadata").get() as
			| { version: string; source: string }
			| undefined;
		if (meta?.version !== INDEX_VERSION || meta.source !== sourceIdentity()) return null;
		const query = db.prepare(
			`SELECT ${columns.map((column, i) => `${column} AS "${fields[i]}"`).join(",")} FROM padron WHERE ruc = ?`,
		);
		const result = new Map<string, PadronEntry | null>();
		for (const ruc of rucs) {
			const row = query.get(ruc) as Record<string, string | null> | undefined;
			const entry = row
				? (Object.fromEntries(
						Object.entries(row).map(([key, value]) => [key, value ?? undefined]),
					) as unknown as PadronEntry)
				: null;
			result.set(ruc, entry);
		}
		return result;
	} catch {
		// Corrupt, stale, or incompatible optional indexes never disable TXT lookup.
		return null;
	} finally {
		db?.close();
	}
}
