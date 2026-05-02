import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { gunzipSync, gzipSync } from "zlib";
import { paths } from "./config.ts";

export interface AuditEntry {
	timestamp: string;
	command: string;
	args: Record<string, unknown>;
	result: "success" | "error" | "dry-run" | "pending";
	details?: Record<string, unknown>;
	screenshot?: string;
	durationMs?: number;
}

export interface AuditCompactResult {
	compactedMonths: string[];
	compactedFiles: string[];
	archivePaths: string[];
	skippedMonths: string[];
}

export interface AuditPruneResult {
	prunedMonths: string[];
	prunedPaths: string[];
}

const MONTHLY_AUDIT_FILE = /^(\d{4}-\d{2})\.jsonl$/;
const LEGACY_DAILY_AUDIT_FILE = /^(\d{4}-\d{2})-\d{2}\.jsonl$/;
const ARCHIVED_AUDIT_FILE = /^(\d{4}-\d{2})\.jsonl\.gz$/;

export const DEFAULT_AUTO_COMPACT_AFTER_MONTHS = 6;
export const DEFAULT_RECOMMENDED_ARCHIVE_MONTHS = 24;

function ensureAuditDir(): void {
	if (!existsSync(paths.auditDir)) mkdirSync(paths.auditDir, { recursive: true });
}

function ensureAuditArchiveDir(): string {
	const dir = join(paths.auditDir, "archive");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function monthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

function parseMonth(month: string): { year: number; month: number } {
	const match = /^(\d{4})-(\d{2})$/.exec(month);
	if (!match) throw new Error(`Invalid month: "${month}". Expected YYYY-MM`);
	const year = Number(match[1]);
	const monthNumber = Number(match[2]);
	if (monthNumber < 1 || monthNumber > 12) throw new Error(`Invalid month: "${month}". Expected YYYY-MM`);
	return { year, month: monthNumber };
}

function monthDiff(currentMonth: string, candidateMonth: string): number {
	const current = parseMonth(currentMonth);
	const candidate = parseMonth(candidateMonth);
	return (current.year - candidate.year) * 12 + (current.month - candidate.month);
}

function auditFileNameForDate(date: Date): string {
	return `${monthKey(date)}.jsonl`;
}

function auditArchivePath(month: string): string {
	return join(ensureAuditArchiveDir(), `${month}.jsonl.gz`);
}

function readArchive(month: string): string {
	const archivePath = auditArchivePath(month);
	if (!existsSync(archivePath)) return "";
	return gunzipSync(readFileSync(archivePath)).toString("utf-8");
}

function readAuditFile(path: string): string {
	return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function listAuditDirFiles(): string[] {
	ensureAuditDir();
	return readdirSync(paths.auditDir).sort();
}

function resolveMonthFromFile(file: string): string | null {
	const monthly = MONTHLY_AUDIT_FILE.exec(file);
	if (monthly) return monthly[1];
	const legacy = LEGACY_DAILY_AUDIT_FILE.exec(file);
	if (legacy) return legacy[1];
	return null;
}

export function listActiveAuditFiles(): string[] {
	return listAuditDirFiles().filter((file) => resolveMonthFromFile(file) !== null);
}

export function listArchivedAuditMonths(): string[] {
	const archiveDir = ensureAuditArchiveDir();
	return readdirSync(archiveDir)
		.map((file) => ARCHIVED_AUDIT_FILE.exec(file)?.[1] || null)
		.filter((month): month is string => month !== null)
		.sort();
}

export function archivedAuditRecoveryPath(month: string): string {
	return auditArchivePath(month);
}

let autoCompacted = false;

function maybeAutoCompact(): void {
	if (autoCompacted) return;
	autoCompacted = true;
	compactAuditLogs({ olderThanMonths: DEFAULT_AUTO_COMPACT_AFTER_MONTHS });
}

export function audit(entry: Omit<AuditEntry, "timestamp">): void {
	ensureAuditDir();
	maybeAutoCompact();
	const file = join(paths.auditDir, auditFileNameForDate(new Date()));
	const full: AuditEntry = { timestamp: new Date().toISOString(), ...entry };
	appendFileSync(file, JSON.stringify(full) + "\n");
}

export function auditScreenshotPath(operation: string): string {
	const dir = join(paths.auditDir, "screenshots");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	return join(dir, `${operation}-${ts}.png`);
}

export function* iterateActiveAuditEntries(): Generator<AuditEntry> {
	maybeAutoCompact();
	for (const file of listActiveAuditFiles()) {
		const path = join(paths.auditDir, file);
		const content = readAuditFile(path);
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				yield JSON.parse(line) as AuditEntry;
			} catch {}
		}
	}
}

export function compactAuditLogs(options: { olderThanMonths?: number; now?: Date } = {}): AuditCompactResult {
	ensureAuditDir();
	const olderThanMonths = options.olderThanMonths ?? DEFAULT_AUTO_COMPACT_AFTER_MONTHS;
	const nowMonth = monthKey(options.now ?? new Date());
	const filesByMonth = new Map<string, string[]>();

	for (const file of listActiveAuditFiles()) {
		const month = resolveMonthFromFile(file);
		if (!month) continue;
		const bucket = filesByMonth.get(month) || [];
		bucket.push(file);
		filesByMonth.set(month, bucket);
	}

	const compactedMonths: string[] = [];
	const compactedFiles: string[] = [];
	const archivePaths: string[] = [];
	const skippedMonths: string[] = [];

	for (const [month, files] of [...filesByMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		if (monthDiff(nowMonth, month) < olderThanMonths) {
			skippedMonths.push(month);
			continue;
		}

		const merged = [readArchive(month), ...files.map((file) => readAuditFile(join(paths.auditDir, file)))]
			.filter((chunk) => chunk.trim().length > 0)
			.join("")
			.replace(/\n*$/, "\n");

		if (!merged.trim()) {
			for (const file of files) rmSync(join(paths.auditDir, file), { force: true });
			compactedMonths.push(month);
			compactedFiles.push(...files.map((file) => join(paths.auditDir, file)));
			archivePaths.push(auditArchivePath(month));
			continue;
		}

		const archivePath = auditArchivePath(month);
		writeFileSync(archivePath, gzipSync(merged));
		for (const file of files) rmSync(join(paths.auditDir, file), { force: true });

		compactedMonths.push(month);
		compactedFiles.push(...files.map((file) => join(paths.auditDir, file)));
		archivePaths.push(archivePath);
	}

	return { compactedMonths, compactedFiles, archivePaths, skippedMonths };
}

export function pruneArchivedAuditLogs(beforeMonth: string): AuditPruneResult {
	parseMonth(beforeMonth);
	const prunedMonths: string[] = [];
	const prunedPaths: string[] = [];
	const archiveDir = ensureAuditArchiveDir();

	for (const file of readdirSync(archiveDir).sort()) {
		const match = ARCHIVED_AUDIT_FILE.exec(file);
		if (!match) continue;
		const month = match[1];
		if (month >= beforeMonth) continue;
		const path = join(archiveDir, file);
		rmSync(path, { force: true });
		prunedMonths.push(month);
		prunedPaths.push(path);
	}

	return { prunedMonths, prunedPaths };
}
