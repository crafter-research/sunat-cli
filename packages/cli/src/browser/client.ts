import { spawn, execSync } from "child_process";

export interface BrowserResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

const SESSION = "sunat";

async function run(args: string[], timeoutMs = 30000): Promise<BrowserResult> {
	return new Promise((resolve, reject) => {
		const proc = spawn("agent-browser", ["--session", SESSION, ...args], {
			timeout: timeoutMs,
			env: { ...process.env },
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 }));
		proc.on("error", reject);
	});
}

async function runRaw(args: string[], timeoutMs = 30000): Promise<BrowserResult> {
	return new Promise((resolve, reject) => {
		const proc = spawn("agent-browser", args, {
			timeout: timeoutMs,
			env: { ...process.env },
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 }));
		proc.on("error", reject);
	});
}

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

let daemonStartedHeaded = false;

export async function killDaemon(): Promise<void> {
	try {
		execSync("pkill -f agent-browser", { stdio: "ignore" });
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
	if (r.exitCode !== 0) throw new Error(`open failed: ${stripAnsi(r.stderr || r.stdout)}`);
	daemonStartedHeaded = useHeaded;
}

export async function snapshot(opts?: { interactive?: boolean }): Promise<string> {
	const args = ["snapshot"];
	if (opts?.interactive) args.push("-i");
	const r = await run(args);
	if (r.exitCode !== 0) throw new Error(`snapshot failed: ${stripAnsi(r.stderr)}`);
	return stripAnsi(r.stdout);
}

export async function click(ref: string): Promise<void> {
	const r = await run(["click", ref]);
	if (r.exitCode !== 0) throw new Error(`click ${ref} failed: ${stripAnsi(r.stderr)}`);
}

export async function fill(ref: string, value: string): Promise<void> {
	const r = await run(["fill", ref, value]);
	if (r.exitCode !== 0) throw new Error(`fill ${ref} failed: ${stripAnsi(r.stderr)}`);
}

export async function select(ref: string, value: string): Promise<void> {
	const r = await run(["select", ref, value]);
	if (r.exitCode !== 0) throw new Error(`select ${ref} failed: ${stripAnsi(r.stderr)}`);
}

export async function evalJS(code: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn("agent-browser", ["--session", SESSION, "eval", "--stdin"], {
			timeout: 15000,
			env: { ...process.env },
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (exitCode) => {
			if (exitCode !== 0) reject(new Error(`eval failed: ${stripAnsi(stderr)}`));
			else resolve(stripAnsi(stdout.trim()));
		});
		proc.on("error", reject);
		proc.stdin.write(code);
		proc.stdin.end();
	});
}

export async function getUrl(): Promise<string> {
	const r = await run(["get", "url"]);
	return stripAnsi(r.stdout);
}

export async function screenshot(path: string): Promise<void> {
	const r = await run(["screenshot", path]);
	if (r.exitCode !== 0) throw new Error(`screenshot failed: ${stripAnsi(r.stderr)}`);
}

export async function stateSave(path: string): Promise<void> {
	const r = await run(["state", "save", path]);
	if (r.exitCode !== 0) throw new Error(`state save failed: ${stripAnsi(r.stderr)}`);
}

export async function stateLoad(path: string): Promise<void> {
	const r = await run(["state", "load", path]);
	if (r.exitCode !== 0) throw new Error(`state load failed: ${stripAnsi(r.stderr)}`);
}

export async function close(): Promise<void> {
	await run(["close"]).catch(() => {});
}

export async function clearBeforeUnload(): Promise<void> {
	await evalJS("window.onbeforeunload = null");
}

export async function mouseMove(x: number, y: number): Promise<void> {
	const r = await runRaw(["--session", SESSION, "mouse", "move", String(x), String(y)]);
	if (r.exitCode !== 0) throw new Error(`mouse move failed: ${stripAnsi(r.stderr)}`);
}

export async function mouseDown(): Promise<void> {
	const r = await runRaw(["--session", SESSION, "mouse", "down"]);
	if (r.exitCode !== 0) throw new Error(`mouse down failed: ${stripAnsi(r.stderr)}`);
}

export async function mouseUp(): Promise<void> {
	const r = await runRaw(["--session", SESSION, "mouse", "up"]);
	if (r.exitCode !== 0) throw new Error(`mouse up failed: ${stripAnsi(r.stderr)}`);
}

export async function reload(): Promise<void> {
	const r = await run(["reload"]);
	if (r.exitCode !== 0) throw new Error(`reload failed: ${stripAnsi(r.stderr)}`);
}

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
