import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { privateChildEnv } from "../data/child-process.ts";
import { secureExistingFile } from "../data/private-storage.ts";
import { isMissingBinary, missingBinaryError, spawnAgentBrowser } from "./dependency.ts";

export interface BrowserResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

const SESSION = "sunat";
const childEnv = () => privateChildEnv(process.env, [], ["AGENT_BROWSER_", "SUNAT_TEST_"]);

async function run(args: string[], timeoutMs = 30000): Promise<BrowserResult> {
	return new Promise((resolve, reject) => {
		const proc = spawnAgentBrowser(["--session", SESSION, ...args], {
			timeout: timeoutMs,
			env: childEnv(),
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 }));
		proc.on("error", (err) => reject(isMissingBinary(err) ? missingBinaryError() : err));
	});
}

async function runRaw(args: string[], timeoutMs = 30000): Promise<BrowserResult> {
	return new Promise((resolve, reject) => {
		const proc = spawnAgentBrowser(args, {
			timeout: timeoutMs,
			env: childEnv(),
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 }));
		proc.on("error", (err) => reject(isMissingBinary(err) ? missingBinaryError() : err));
	});
}

async function runBatchFromStdin(command: string[], timeoutMs = 30000): Promise<BrowserResult> {
	return new Promise((resolve, reject) => {
		const proc = spawnAgentBrowser(["--session", SESSION, "batch", "--bail", "--json"], {
			timeout: timeoutMs,
			env: childEnv(),
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 }));
		proc.on("error", (err) => reject(isMissingBinary(err) ? missingBinaryError() : err));
		proc.stdin.end(JSON.stringify([command]));
	});
}

function stripAnsi(s: string): string {
	return s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

let daemonStartedHeaded = false;

export async function killDaemon(): Promise<void> {
	try {
		execSync("pkill -f agent-browser", { env: childEnv(), stdio: "ignore" });
	} catch {}
	daemonStartedHeaded = false;
	await sleep(1500);
}

export async function ensureHeadedDaemon(): Promise<void> {
	if (daemonStartedHeaded) return;
	await killDaemon();
	daemonStartedHeaded = true;
}

export async function open(url: string, opts?: { headed?: boolean }): Promise<void> {
	const useHeaded = opts?.headed ?? true;
	if (useHeaded && !daemonStartedHeaded) {
		await ensureHeadedDaemon();
	}
	const args: string[] = [];
	if (useHeaded) args.push("--headed");
	args.push("--session", SESSION, "open", url);
	const r = await runRaw(args, 30000);
	if (r.exitCode !== 0) throw new Error("Browser navigation failed");
	daemonStartedHeaded = useHeaded;
}

export async function snapshot(opts?: { interactive?: boolean }): Promise<string> {
	const args = ["snapshot"];
	if (opts?.interactive) args.push("-i");
	const r = await run(args);
	if (r.exitCode !== 0) throw new Error("Browser snapshot failed");
	return stripAnsi(r.stdout);
}

export async function click(ref: string): Promise<void> {
	const r = await run(["click", ref]);
	if (r.exitCode !== 0) throw new Error("Browser click failed");
}

export async function fill(ref: string, value: string): Promise<void> {
	const r = await runBatchFromStdin(["fill", ref, value]);
	if (r.exitCode !== 0) throw new Error(`fill ${ref} failed`);
}

export async function select(ref: string, value: string): Promise<void> {
	const r = await run(["select", ref, value]);
	if (r.exitCode !== 0) throw new Error("Browser selection failed");
}

export async function evalJS(code: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawnAgentBrowser(["--session", SESSION, "eval", "--stdin"], {
			timeout: 15000,
			env: childEnv(),
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (exitCode) => {
			if (exitCode !== 0) reject(new Error("Browser evaluation failed"));
			else resolve(stripAnsi(stdout.trim()));
		});
		proc.on("error", (err) => reject(isMissingBinary(err) ? missingBinaryError() : err));
		proc.stdin.write(code);
		proc.stdin.end();
	});
}

export async function getUrl(): Promise<string> {
	const r = await run(["get", "url"]);
	return stripAnsi(r.stdout);
}

export async function stateSave(path: string): Promise<void> {
	const r = await run(["state", "save", path]);
	if (r.exitCode !== 0) throw new Error("Browser state save failed");
	try {
		secureExistingFile(path);
	} catch (error) {
		rmSync(path, { force: true });
		throw error;
	}
}

export async function stateLoad(path: string): Promise<void> {
	secureExistingFile(path);
	const r = await run(["state", "load", path]);
	if (r.exitCode !== 0) throw new Error("Browser state load failed");
}

export async function close(): Promise<void> {
	await run(["close"]).catch(() => {});
}

export async function clearBeforeUnload(): Promise<void> {
	await evalJS("window.onbeforeunload = null");
}

export async function mouseMove(x: number, y: number): Promise<void> {
	const r = await runRaw(["--session", SESSION, "mouse", "move", String(x), String(y)]);
	if (r.exitCode !== 0) throw new Error("Browser mouse move failed");
}

export async function mouseDown(): Promise<void> {
	const r = await runRaw(["--session", SESSION, "mouse", "down"]);
	if (r.exitCode !== 0) throw new Error("Browser mouse down failed");
}

export async function mouseUp(): Promise<void> {
	const r = await runRaw(["--session", SESSION, "mouse", "up"]);
	if (r.exitCode !== 0) throw new Error("Browser mouse up failed");
}

export async function reload(): Promise<void> {
	const r = await run(["reload"]);
	if (r.exitCode !== 0) throw new Error("Browser reload failed");
}

export async function routeAbort(pattern: string): Promise<void> {
	const r = await run(["network", "route", pattern, "--abort"]);
	if (r.exitCode !== 0) throw new Error("Browser route setup failed");
}

export async function unroute(pattern: string): Promise<void> {
	const r = await run(["network", "unroute", pattern]);
	if (r.exitCode !== 0) throw new Error("Browser route cleanup failed");
}

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
