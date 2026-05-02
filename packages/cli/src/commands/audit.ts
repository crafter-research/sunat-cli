import { Command } from "commander";
import {
	archivedAuditRecoveryPath,
	compactAuditLogs,
	DEFAULT_AUTO_COMPACT_AFTER_MONTHS,
	DEFAULT_RECOMMENDED_ARCHIVE_MONTHS,
	listArchivedAuditMonths,
	pruneArchivedAuditLogs,
} from "../data/audit.ts";
import { output, outputError } from "../utils/output.ts";

type Format = "json" | "table" | "auto";

function getFormat(cmd: Command): Format {
	let parent: Command | null = cmd;
	while (parent) {
		const opts = parent.opts();
		if (opts.output) return opts.output as Format;
		parent = parent.parent;
	}
	return "auto";
}

function parseMonths(value: string): number {
	const months = Number(value);
	if (!Number.isInteger(months) || months < 0)
		throw new Error(`Invalid months: "${value}". Expected a non-negative integer`);
	return months;
}

export function createAuditCommand(): Command {
	const audit = new Command("audit").description("Manage local audit log rotation and archives.");

	audit
		.command("compact")
		.description("Compress active audit months older than the retention window into ~/.sunat/audit/archive.")
		.option(
			"--older-than-months <n>",
			`Compact months with age >= n. Default: ${DEFAULT_AUTO_COMPACT_AFTER_MONTHS}`,
			String(DEFAULT_AUTO_COMPACT_AFTER_MONTHS),
		)
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const olderThanMonths = parseMonths(opts.olderThanMonths);
				const result = compactAuditLogs({ olderThanMonths });
				const archivedMonths = listArchivedAuditMonths();
				const json = {
					success: true,
					policy: {
						autoCompactAfterMonths: DEFAULT_AUTO_COMPACT_AFTER_MONTHS,
						recommendedArchiveMonths: DEFAULT_RECOMMENDED_ARCHIVE_MONTHS,
						autoDelete: false,
					},
					compactedMonths: result.compactedMonths,
					compactedFiles: result.compactedFiles,
					archivePaths: result.archivePaths,
					skippedMonths: result.skippedMonths,
					archivedMonths,
					recovery: result.compactedMonths.map((month) => ({
						month,
						archivePath: archivedAuditRecoveryPath(month),
						command: `gunzip -c ${archivedAuditRecoveryPath(month)} > ~/.sunat/audit/${month}.jsonl`,
					})),
				};
				output(format, {
					json,
					table: {
						headers: ["Month", "Archive", "Recovery"],
						rows:
							result.compactedMonths.length > 0
								? result.compactedMonths.map((month) => [
										month,
										archivedAuditRecoveryPath(month),
										`gunzip -c .../${month}.jsonl.gz > ~/.sunat/audit/${month}.jsonl`,
									])
								: [["-", "-", "no months compacted"]],
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	audit
		.command("prune")
		.description("Delete archived audit months before a cutoff. This never runs automatically.")
		.requiredOption("--before <YYYY-MM>", "Delete archived months strictly before this month")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const result = pruneArchivedAuditLogs(opts.before);
				output(format, {
					json: {
						success: true,
						before: opts.before,
						prunedMonths: result.prunedMonths,
						prunedPaths: result.prunedPaths,
						autoDelete: false,
					},
					table: {
						headers: ["Month", "Archive"],
						rows:
							result.prunedMonths.length > 0
								? result.prunedMonths.map((month, i) => [month, result.prunedPaths[i]])
								: [["-", "no archived months pruned"]],
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return audit;
}
