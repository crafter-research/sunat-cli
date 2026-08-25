import { execFileSync } from "node:child_process";

export const AGENT_BROWSER_INSTALL = [
	"npm install -g agent-browser      # all platforms",
	"brew install agent-browser        # macOS",
	"agent-browser install             # download Chrome, first time only",
].join("\n");

/**
 * `agent-browser` is spawned by name, so it is a PATH dependency that npm
 * cannot see. When it is absent the spawn fails with ENOENT and the caller
 * reports whatever it was doing, which reads as a broken CLI rather than a
 * missing tool.
 *
 * This turns that into an error that names the cause and the fix, in the same
 * shape as the shebang problem the Node build removed.
 */
export function isMissingBinary(err: unknown): boolean {
	return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function missingBinaryError(): Error {
	const e = new Error(
		`agent-browser is not installed. RHE, F616 and the portal scrapers drive a real browser through it.\n\n${AGENT_BROWSER_INSTALL.split(
			"\n",
		)
			.map((l) => `  ${l}`)
			.join("\n")}\n\nOr run it once without installing: npx agent-browser open example.com`,
	);
	(e as NodeJS.ErrnoException).code = "AGENT_BROWSER_MISSING";
	return e;
}

export type BinaryStatus = {
	installed: boolean;
	version?: string;
	hint?: string;
};

/** Cheap presence probe for `doctor`. Never throws. */
export function probeAgentBrowser(): BinaryStatus {
	try {
		const out = execFileSync("agent-browser", ["--version"], {
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return { installed: true, version: out.trim() };
	} catch (err) {
		if (isMissingBinary(err)) {
			return { installed: false, hint: AGENT_BROWSER_INSTALL };
		}
		return { installed: false, hint: `agent-browser is on PATH but did not answer --version: ${String(err)}` };
	}
}
