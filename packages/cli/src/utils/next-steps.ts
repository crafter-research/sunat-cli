import type { OutputFormat } from "./output.ts";
import { bold, dim, info, muted } from "./style.ts";

/**
 * What the caller can run next, emitted after a command succeeds.
 *
 * Two constraints decided the channel, and both point at stderr:
 *
 * 1. stdout is the published machine contract. Several commands emit an array
 *    (`renta presentaciones`, `renta casillas`), which `output` writes as
 *    NDJSON, and an array has nowhere to put a new key. Anything added to
 *    stdout would either change a shape agents already parse or be impossible.
 * 2. Data on stdout, diagnostics on stderr, the same split `outputError`
 *    already makes. A caller doing `cmd > out.json` must not find guidance in
 *    the file it is about to parse.
 *
 * So this is purely additive: every existing byte on stdout is unchanged, and
 * a consumer that ignores stderr sees exactly what it saw before.
 *
 * Field names match the cligentic `agent/next-steps` block, which this repo
 * deliberately does not depend on, so the shape is not a third dialect.
 */
export type NextStep = {
	/** The literal command to run, with real values already substituted. */
	command: string;
	/** Short reason the step matters. */
	description: string;
	/** Suggested rather than expected. */
	optional?: boolean;
};

/**
 * Never throws and never exits: guidance must not be able to fail a command
 * that already succeeded.
 */
export function emitNextSteps(steps: NextStep[], format: OutputFormat): void {
	if (steps.length === 0) return;

	const resolved = format === "auto" ? (process.stdout.isTTY ? "table" : "json") : format;

	if (resolved === "json") {
		for (const step of steps) {
			process.stderr.write(`${JSON.stringify({ type: "next-step", ...step })}\n`);
		}
		return;
	}

	process.stderr.write(`\n${bold("Next steps:")}\n`);
	for (const step of steps) {
		const marker = step.optional ? muted("○") : info("→");
		process.stderr.write(`  ${marker} ${step.command}  ${dim(step.description)}\n`);
	}
	process.stderr.write("\n");
}
