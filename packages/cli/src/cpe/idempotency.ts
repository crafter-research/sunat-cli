/**
 * Idempotency cache for CPE emissions, keyed by RUC+tipo+serie+numero.
 *
 * Reads the audit JSONL log to find a previous successful emission. If found,
 * returns the cached CDR so the caller does NOT re-submit to SUNAT (which
 * would either return cached itself or — worse — bump correlativo).
 *
 * Two-phase write:
 *   1. Pre-write `pending` entry BEFORE the SOAP call (audit trail even if process crashes)
 *   2. Post-write `success` or `failed` entry AFTER the SOAP returns
 *
 * Stale `pending` entries (>1 hour old) are surfaced by `cpe doctor` so the
 * operator can investigate (likely a crash mid-submit).
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { audit } from "../data/audit.ts";
import { paths } from "../data/config.ts";
import type { CpeResult } from "./drivers/types.ts";

export type CpeTipo = "01" | "03" | "07" | "08" | "09";

export interface IdempotencyKey {
	emisorRuc: string;
	tipo: CpeTipo;
	serie: string;
	numero: number;
}

export interface AuditEntry {
	timestamp: string;
	command: string;
	args: Record<string, unknown>;
	result: "success" | "error" | "dry-run" | "pending";
	details?: Record<string, unknown>;
}

const STALE_PENDING_MS = 60 * 60 * 1000; // 1 hour

export function idempotencyKey(key: IdempotencyKey): string {
	return `${key.emisorRuc}-${key.tipo}-${key.serie}-${key.numero}`;
}

export function findCachedResult(key: IdempotencyKey): CpeResult | null {
	const id = idempotencyKey(key);
	for (const entry of iterateAudit()) {
		if (entry.result !== "success") continue;
		const entryId = entry.details?.id as string | undefined;
		if (entryId === id) {
			const d = entry.details as Record<string, unknown>;
			return {
				id,
				serie: key.serie,
				numero: key.numero,
				hash: (d.hash as string) || "",
				status: (d.status as CpeResult["status"]) || "accepted",
				cdrCode: d.cdrCode as string | undefined,
				cdrDesc: d.cdrDesc as string | undefined,
				xml: d.xml as string | undefined,
				ts: entry.timestamp,
			};
		}
	}
	return null;
}

export function findStalePendings(now: Date = new Date()): AuditEntry[] {
	const stale: AuditEntry[] = [];
	for (const entry of iterateAudit()) {
		if (entry.result !== "pending") continue;
		const age = now.getTime() - new Date(entry.timestamp).getTime();
		if (age > STALE_PENDING_MS) stale.push(entry);
	}
	return stale;
}

export function logPending(key: IdempotencyKey, command: string, args: Record<string, unknown>): void {
	audit({
		command,
		args,
		result: "pending",
		details: { id: idempotencyKey(key), stage: "pre-submit" },
	});
}

export function logSuccess(key: IdempotencyKey, command: string, args: Record<string, unknown>, result: CpeResult): void {
	audit({
		command,
		args,
		result: "success",
		details: {
			id: idempotencyKey(key),
			hash: result.hash,
			status: result.status,
			cdrCode: result.cdrCode,
			cdrDesc: result.cdrDesc,
			xml: result.xml,
		},
	});
}

export function logFailure(key: IdempotencyKey, command: string, args: Record<string, unknown>, error: string): void {
	audit({
		command,
		args,
		result: "error",
		details: { id: idempotencyKey(key), error },
	});
}

function* iterateAudit(): Generator<AuditEntry> {
	const dir = paths.auditDir;
	if (!existsSync(dir)) return;
	const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
	for (const file of files) {
		const path = join(dir, file);
		const content = readFileSync(path, "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				yield JSON.parse(line) as AuditEntry;
			} catch {
				// skip malformed line
			}
		}
	}
}
