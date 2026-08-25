import { type OutputFormat, resolveFormat } from "./output.ts";
import { dim, warn } from "./style.ts";

/**
 * `--json` used to mean the input payload here, while almost everywhere else in
 * the CLI ecosystem it means machine-readable output. An agent that learned the
 * common convention runs `rhe emit --json` expecting output and gets an error
 * about a payload it never meant to send. `--params` is the canonical input
 * name and the `cpe` namespace already used it, so the rename aligns three
 * namespaces rather than inventing a fourth term.
 *
 * The notice goes to stderr for the same reason `emitNextSteps` does: stdout is
 * the published machine contract, and a caller doing `cmd > out.json` must not
 * find diagnostics in the file it is about to parse. Every existing byte on
 * stdout is unchanged.
 */
export type DeprecatedFlagNotice = {
	/** Deprecated spelling, as written on the command line. */
	deprecated: string;
	/** Flag the caller should move to. */
	replacement: string;
	/** True when both spellings were passed and `replacement` took precedence. */
	ignored?: boolean;
};

/**
 * Never throws and never exits: a deprecation notice must not be able to fail a
 * command that would otherwise work.
 */
export function emitDeprecation(notice: DeprecatedFlagNotice, format: OutputFormat): void {
	const action = notice.ignored
		? `${notice.replacement} was also passed and takes precedence, so the ${notice.deprecated} value was ignored`
		: `use ${notice.replacement} instead`;
	const message = `${notice.deprecated} is deprecated, ${action}. It will be removed in a later 0.x release.`;

	if (resolveFormat(format) === "json") {
		process.stderr.write(
			`${JSON.stringify({
				type: "deprecation",
				deprecated: notice.deprecated,
				replacement: notice.replacement,
				ignored: notice.ignored ?? false,
				message,
			})}\n`,
		);
		return;
	}

	process.stderr.write(`${warn("Deprecated")}  ${message}\n`);
	process.stderr.write(`${dim(`  Run --help to see the current flags.`)}\n`);
}

/**
 * Resolves the input payload from the canonical flag and its deprecated alias,
 * emitting the notice as a side effect when the alias was used.
 *
 * `--params` wins when both are passed. The rule is deterministic and matches
 * the precedence the `cpe` namespace already documents, and it keeps a caller
 * mid-migration working: a script that gained `--params` while still passing
 * `--json` gets the new value rather than an error, and the notice tells them
 * their `--json` value was dropped.
 */
export function resolveParams(
	opts: { params?: string; json?: string },
	replacement: string,
	deprecated: string,
	format: OutputFormat,
): string | undefined {
	if (opts.json !== undefined) {
		emitDeprecation({ deprecated, replacement, ignored: opts.params !== undefined }, format);
	}
	return opts.params ?? opts.json;
}
