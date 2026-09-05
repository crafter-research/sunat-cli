/**
 * Error thrown when input JSON parameters passed via CLI flags (e.g. `--params`)
 * cannot be parsed. Provides a machine-readable code, identifies the affected
 * flag, and attaches an actionable schema inspection hint when a matching
 * schema resource exists.
 */
export class InvalidJsonParamsError extends Error {
	readonly code = "INVALID_PARAMS_JSON";
	readonly flag: string;
	readonly schema?: string;
	readonly hint?: string;

	constructor(opts?: { flag?: string; schema?: string; cause?: unknown }) {
		const flag = opts?.flag ?? "--params";
		super(`Invalid JSON in ${flag}.`);
		this.name = "InvalidJsonParamsError";
		this.flag = flag;
		this.schema = opts?.schema;
		if (opts?.schema) {
			this.hint = `Run: sunat-cli schema ${opts.schema}`;
		}
		if (opts?.cause) {
			this.cause = opts.cause;
		}
	}
}

/**
 * Parses raw JSON parameters from CLI input into a typed object.
 *
 * Wraps standard JSON.parse to intercept raw SyntaxErrors and produce
 * structured, actionable diagnostics that point callers to the matching schema.
 */
export function parseJsonParams<T = Record<string, unknown>>(
	raw: string,
	options?: { schema?: string; flag?: string },
): T {
	try {
		return JSON.parse(raw) as T;
	} catch (cause) {
		throw new InvalidJsonParamsError({
			flag: options?.flag,
			schema: options?.schema,
			cause,
		});
	}
}
