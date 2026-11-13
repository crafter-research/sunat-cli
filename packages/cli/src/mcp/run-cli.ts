import { spawn } from "node:child_process";

export type CliResult = { ok: boolean; text: string };

/**
 * MCP clients cut long tool results on their own, usually without saying
 * where. Cutting here, with a sentence that says so, lets the model ask for a
 * narrower range instead of reasoning over a silently incomplete list.
 */
const MAX_OUTPUT_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * How to start this same CLI again.
 *
 * `process.execPath` plus `process.argv[1]` is the runtime and entry file that
 * are running right now: `bun bin/sunat.ts` from source, `node dist/sunat.js`
 * from the published package. Resolving `sunat-cli` on PATH instead could pick
 * up a different installed version than the server the client connected to.
 */
function selfCommand(): { command: string; entry: string } {
	const entry = process.argv[1];
	if (!entry) throw new Error("Cannot locate the sunat-cli entry file to run commands");
	return { command: process.execPath, entry };
}

function truncate(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated at ${MAX_OUTPUT_CHARS} characters of ${text.length}; narrow the request with a filter or a smaller range]`;
}

/**
 * Runs one CLI command in a child process and returns its output as text.
 *
 * A child process, rather than calling the command's handler in this process,
 * for three reasons that are all load-bearing over stdio:
 *
 * - stdout of this process is the MCP protocol channel. Command handlers and
 *   the browser login print progress to stdout; in-process, one such line
 *   corrupts the stream and the client drops the connection.
 * - `outputError` ends the process with exit code 1. In-process, the first
 *   failed tool call would take the whole server down with it.
 * - the child is the real CLI, so a tool call passes through the same
 *   validation, confirmation gates and audit log as a shell invocation.
 *
 * The child inherits this process's environment unfiltered, unlike the
 * agent-browser children that get `privateChildEnv`: it is the same program
 * and needs the same SUNAT_* and CPE_* variables the operator configured for
 * the server. stdin is closed so a command that would prompt fails fast with
 * its non-interactive error instead of waiting forever.
 */
export function runCli(argv: string[], opts: { plainText?: boolean; timeoutMs?: number } = {}): Promise<CliResult> {
	const { command, entry } = selfCommand();
	const args = opts.plainText ? [entry, ...argv] : [entry, "-o", "json", ...argv];
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1" },
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
			stderr += chunk;
		});

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ ok: false, text: `Could not start sunat-cli: ${err.message}` });
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			const out = stdout.trim();
			const err = stderr.trim();
			if (timedOut) {
				resolve({
					ok: false,
					text: truncate(
						[`Timed out after ${Math.round(timeoutMs / 1000)}s: sunat-cli ${argv[0] ?? ""}`, err, out]
							.filter(Boolean)
							.join("\n\n"),
					),
				});
				return;
			}
			if (code === 0) {
				// stderr on success is `nextSteps` and deprecation notices written for
				// a person at a shell. They name CLI commands, not tools, so passing
				// them on would point the model at something it cannot call.
				resolve({ ok: true, text: truncate(out || "(the command succeeded with no output)") });
				return;
			}
			// A failed command writes its error envelope to stderr and may have
			// written partial data to stdout first; the model needs both.
			resolve({
				ok: false,
				text: truncate([err, out].filter(Boolean).join("\n\n") || `sunat-cli exited with code ${code}`),
			});
		});
	});
}
