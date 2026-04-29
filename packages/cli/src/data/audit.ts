import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { paths } from "./config.ts";

interface AuditEntry {
	timestamp: string;
	command: string;
	args: Record<string, unknown>;
	result: "success" | "error" | "dry-run" | "pending";
	details?: Record<string, unknown>;
	screenshot?: string;
	durationMs?: number;
}

export function audit(entry: Omit<AuditEntry, "timestamp">): void {
	const dir = paths.auditDir;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const today = new Date().toISOString().split("T")[0];
	const file = join(dir, `${today}.jsonl`);
	const full: AuditEntry = { timestamp: new Date().toISOString(), ...entry };

	appendFileSync(file, JSON.stringify(full) + "\n");
}

export function auditScreenshotPath(operation: string): string {
	const dir = join(paths.auditDir, "screenshots");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	return join(dir, `${operation}-${ts}.png`);
}
