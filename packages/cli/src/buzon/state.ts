import { existsSync, readFileSync } from "node:fs";
import { paths } from "../data/config.ts";
import { ensurePrivateDir, secureExistingFile, writePrivateFile } from "../data/private-storage.ts";
import type { BuzonItem, BuzonListResult, StoredBuzonState } from "./types.ts";

export class BuzonStateError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly hint?: string,
	) {
		super(message);
		this.name = "BuzonStateError";
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function nullableString(value: unknown): boolean {
	return value === null || typeof value === "string";
}

function nonnegativeNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validItem(value: unknown): boolean {
	if (!record(value)) return false;
	if (
		!exactKeys(value, [
			"id",
			"messageCode",
			"kind",
			"subject",
			"sentAtObserved",
			"publishedAtObserved",
			"validUntilObserved",
			"stateCodeObserved",
			"urgentObserved",
			"starredObserved",
			"noticeObserved",
			"attachmentCountObserved",
			"folderCodeObserved",
			"labelCodeObserved",
			"newSincePrevious",
			"sourceEndpoint",
		])
	)
		return false;
	return (
		typeof value.id === "string" &&
		typeof value.messageCode === "string" &&
		(value.kind === "message" || value.kind === "notification") &&
		value.id === `${value.kind}:${value.messageCode}` &&
		typeof value.subject === "string" &&
		nullableString(value.sentAtObserved) &&
		nullableString(value.publishedAtObserved) &&
		nullableString(value.validUntilObserved) &&
		nullableString(value.stateCodeObserved) &&
		typeof value.urgentObserved === "boolean" &&
		typeof value.starredObserved === "boolean" &&
		typeof value.noticeObserved === "boolean" &&
		nonnegativeNumber(value.attachmentCountObserved) &&
		nullableString(value.folderCodeObserved) &&
		nullableString(value.labelCodeObserved) &&
		typeof value.newSincePrevious === "boolean" &&
		value.sourceEndpoint === "listNotiMenPag"
	);
}

function validSummary(value: unknown): boolean {
	if (!record(value)) return false;
	if (
		!exactKeys(value, [
			"kind",
			"pagesFetched",
			"observedCount",
			"reportedTotalsObserved",
			"reportedRecordsObserved",
			"countMismatch",
		])
	)
		return false;
	return (
		(value.kind === "message" || value.kind === "notification") &&
		nonnegativeNumber(value.pagesFetched) &&
		nonnegativeNumber(value.observedCount) &&
		Array.isArray(value.reportedTotalsObserved) &&
		value.reportedTotalsObserved.every(nonnegativeNumber) &&
		Array.isArray(value.reportedRecordsObserved) &&
		value.reportedRecordsObserved.every(nonnegativeNumber) &&
		typeof value.countMismatch === "boolean"
	);
}

function validState(value: unknown): value is StoredBuzonState {
	if (!record(value)) return false;
	if (
		!exactKeys(value, [
			"version",
			"fetchedAt",
			"source",
			"readOnlyBoundary",
			"overview",
			"summaries",
			"changes",
			"items",
		])
	)
		return false;
	if (!record(value.overview) || !exactKeys(value.overview, ["foldersObserved", "alertsObserved"])) return false;
	if (
		!record(value.changes) ||
		!exactKeys(value.changes, ["baselineCreated", "newCount", "knownCount", "missingCount", "totalCount"])
	)
		return false;
	return (
		value.version === "1.0.0" &&
		typeof value.fetchedAt === "string" &&
		value.source === "SUNAT Buzón SOL legacy visor" &&
		value.readOnlyBoundary === "metadata-only" &&
		nonnegativeNumber(value.overview.foldersObserved) &&
		nonnegativeNumber(value.overview.alertsObserved) &&
		Array.isArray(value.summaries) &&
		value.summaries.every(validSummary) &&
		typeof value.changes.baselineCreated === "boolean" &&
		nonnegativeNumber(value.changes.newCount) &&
		nonnegativeNumber(value.changes.knownCount) &&
		nonnegativeNumber(value.changes.missingCount) &&
		nonnegativeNumber(value.changes.totalCount) &&
		Array.isArray(value.items) &&
		value.items.every(validItem)
	);
}

export function readBuzonState(): StoredBuzonState | null {
	if (!existsSync(paths.buzonState)) return null;
	try {
		ensurePrivateDir(paths.buzonDir);
		secureExistingFile(paths.buzonState);
		const parsed = JSON.parse(readFileSync(paths.buzonState, "utf8"));
		if (!validState(parsed)) throw new Error("invalid state");
		return parsed;
	} catch {
		throw new BuzonStateError(
			"The local Buzón snapshot is invalid.",
			"bad-state",
			`Move ${paths.buzonState} aside and run 'sunat-cli buzon list' again.`,
		);
	}
}

export function applyBuzonChanges(result: Omit<BuzonListResult, "changes">): StoredBuzonState {
	const previous = readBuzonState();
	const previousIds = new Set(previous?.items.map((item) => item.id) ?? []);
	const currentIds = new Set(result.items.map((item) => item.id));
	const baselineCreated = previous === null;
	const items: BuzonItem[] = result.items.map((item) => ({
		id: item.id,
		messageCode: item.messageCode,
		kind: item.kind,
		subject: item.subject,
		sentAtObserved: item.sentAtObserved,
		publishedAtObserved: item.publishedAtObserved,
		validUntilObserved: item.validUntilObserved,
		stateCodeObserved: item.stateCodeObserved,
		urgentObserved: item.urgentObserved,
		starredObserved: item.starredObserved,
		noticeObserved: item.noticeObserved,
		attachmentCountObserved: item.attachmentCountObserved,
		folderCodeObserved: item.folderCodeObserved,
		labelCodeObserved: item.labelCodeObserved,
		newSincePrevious: baselineCreated ? false : !previousIds.has(item.id),
		sourceEndpoint: "listNotiMenPag",
	}));
	const state: StoredBuzonState = {
		...result,
		changes: {
			baselineCreated,
			newCount: items.filter((item) => item.newSincePrevious).length,
			knownCount: items.filter((item) => !item.newSincePrevious).length,
			missingCount: previous ? previous.items.filter((item) => !currentIds.has(item.id)).length : 0,
			totalCount: items.length,
		},
		items,
	};
	writePrivateFile(paths.buzonState, `${JSON.stringify(state, null, 2)}\n`);
	return state;
}
