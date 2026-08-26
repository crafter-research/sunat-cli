import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { createRequire } from "node:module";
import crossSpawn from "cross-spawn";

const require = createRequire(import.meta.url);
const crossSpawnPath = require.resolve("cross-spawn");
const nodeProxy =
	'const spawn=require(process.argv[1]);const child=spawn("agent-browser",process.argv.slice(2),{stdio:"inherit",env:process.env});child.on("error",error=>process.exit(error&&error.code==="ENOENT"?127:1));child.on("exit",(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exit(code??1)});';

function invocation(args: string[]): { command: string; args: string[] } {
	if (process.platform === "win32" && process.versions.bun) {
		return { command: "node", args: ["-e", nodeProxy, "--", crossSpawnPath, ...args] };
	}
	return { command: "agent-browser", args };
}

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

export function spawnAgentBrowser(args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
	const target = invocation(args);
	return crossSpawn(target.command, target.args, options) as ChildProcessWithoutNullStreams;
}

export function requireAgentBrowser(status: BinaryStatus = probeAgentBrowser()): void {
	if (status.installed) return;
	if (status.hint === AGENT_BROWSER_INSTALL) throw missingBinaryError();
	throw new Error(status.hint || "agent-browser is unavailable");
}

/** Cheap presence probe for `doctor`. Never throws. */
export function probeAgentBrowser(env: NodeJS.ProcessEnv = process.env): BinaryStatus {
	try {
		const target = invocation(["--version"]);
		const result = crossSpawn.sync(target.command, target.args, {
			encoding: "utf-8",
			env,
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		if (result.error) throw result.error;
		if (result.status === 127) throw Object.assign(new Error("agent-browser was not found"), { code: "ENOENT" });
		if (result.status !== 0) throw new Error(`agent-browser --version exited with status ${result.status}`);
		return { installed: true, version: result.stdout.trim() };
	} catch (err) {
		if (isMissingBinary(err)) {
			return { installed: false, hint: AGENT_BROWSER_INSTALL };
		}
		return { installed: false, hint: `agent-browser is on PATH but did not answer --version: ${String(err)}` };
	}
}
