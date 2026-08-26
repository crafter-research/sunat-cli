import { Command, InvalidArgumentError } from "commander";
import { BuzonPortalError, collectBuzon, openBuzonPortal } from "../../buzon/portal.ts";
import { applyBuzonChanges, BuzonStateError, readBuzonState } from "../../buzon/state.ts";
import type { BuzonListResult } from "../../buzon/types.ts";
import { isHumanFormat, output, outputError } from "../../utils/output.ts";
import { dim, muted, ok, truncateVisible, warn } from "../../utils/style.ts";

function parseMaxPages(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		throw new InvalidArgumentError("must be an integer from 1 to 100");
	}
	return parsed;
}

function fail(error: unknown, format: "json" | "table" | "auto"): never {
	if (error instanceof BuzonPortalError || error instanceof BuzonStateError) {
		outputError(error.message, format, { code: error.code, hint: error.hint });
	}
	outputError(error instanceof Error ? error.message : String(error), format);
	process.exit(1);
}

function shortDate(value: string | null): string {
	return value ? truncateVisible(value, 16) : dim("unknown");
}

function renderMismatches(result: BuzonListResult): void {
	for (const summary of result.summaries.filter((entry) => entry.countMismatch)) {
		console.error(
			`${warn("!")} ${summary.kind}: observed ${summary.observedCount}; SUNAT reported totals ${summary.reportedTotalsObserved.join(", ") || "none"} and records ${summary.reportedRecordsObserved.join(", ") || "none"}`,
		);
	}
}

export function createBuzonCommand(): Command {
	const buzon = new Command("buzon").description(
		"Read Buzón SOL metadata locally. Does not open message bodies, download attachments, file or pay.",
	);
	const format = (command: Command) => command.parent?.parent?.opts().output || "auto";

	buzon
		.command("list")
		.description("List message and notification metadata, then save a private local snapshot")
		.option("--max-pages <count>", "Maximum pages per inbox, from 1 to 100", parseMaxPages, 25)
		.action(async (options, command) => {
			const fmt = format(command);
			let portal: Awaited<ReturnType<typeof openBuzonPortal>> | null = null;
			try {
				portal = await openBuzonPortal();
				const overview = await portal.fetchOverview();
				const collected = await collectBuzon(options.maxPages, portal.fetchPage);
				const state = applyBuzonChanges({
					version: "1.0.0",
					fetchedAt: new Date().toISOString(),
					source: "SUNAT Buzón SOL legacy visor",
					readOnlyBoundary: "metadata-only",
					overview,
					summaries: collected.summaries,
					items: collected.items,
				});
				if (isHumanFormat(fmt)) renderMismatches(state);
				output(fmt, {
					json: state,
					table: {
						headers: ["NEW", "TYPE", "SENT", "SUBJECT", "ATT"],
						rows: state.items.map((item) => [
							item.newSincePrevious ? ok("yes") : dim("no"),
							item.kind,
							shortDate(item.sentAtObserved),
							truncateVisible(item.subject || "(no subject)", 58),
							String(item.attachmentCountObserved),
						]),
					},
				});
			} catch (error) {
				await portal?.close();
				portal = null;
				fail(error, fmt);
			} finally {
				await portal?.close();
			}
		});

	buzon
		.command("status")
		.description("Read the last local Buzón snapshot without contacting SUNAT")
		.action((_options, command) => {
			const fmt = format(command);
			try {
				const state = readBuzonState();
				if (!state) {
					throw new BuzonStateError(
						"No local Buzón snapshot exists.",
						"no-snapshot",
						"Run 'sunat-cli buzon list' first.",
					);
				}
				output(fmt, {
					json: {
						version: state.version,
						fetchedAt: state.fetchedAt,
						readOnlyBoundary: state.readOnlyBoundary,
						overview: state.overview,
						summaries: state.summaries,
						changes: state.changes,
					},
					table: {
						headers: ["PROPERTY", "VALUE"],
						rows: [
							["Fetched", state.fetchedAt],
							["Items", String(state.changes.totalCount)],
							["New", state.changes.baselineCreated ? muted("baseline") : String(state.changes.newCount)],
							["Known", String(state.changes.knownCount)],
							["Missing", String(state.changes.missingCount)],
						],
					},
				});
			} catch (error) {
				fail(error, fmt);
			}
		});

	return buzon;
}
