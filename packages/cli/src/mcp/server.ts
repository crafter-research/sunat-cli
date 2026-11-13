import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CliResult, runCli } from "./run-cli.ts";
import { buildArgv, buildTools, type ToolDef } from "./tools.ts";

/**
 * Sent to the client on connect and placed in the model's context, so it
 * carries what the model must know before its first call: the order of
 * operations and where the server deliberately stops.
 */
const INSTRUCTIONS = [
	"sunat-cli automates SUNAT, Peru's tax authority, for the taxpayer who owns this machine. Mistakes have financial and legal consequences, so work in this order:",
	"",
	"1. sunat_doctor, then sunat_whoami, to learn what is installed and which sessions are live.",
	"2. sunat_schema before building any payload. Never guess a field name.",
	"3. Validate first: rhe_emit_preview with mode dry_run, f616_declare_dry_run, cpe_preview.",
	"4. Show the user the validated result and SUNAT's own preview before anything else happens.",
	"",
	"This server cannot perform a live SUNAT write. Issuing an RHE, filing an F616, emitting a comprobante and every SIRE or baja operation are done by the user in a terminal with the sunat-cli command; say which command to run and stop there. Do not look for another way to submit.",
	"",
	"Credentials never pass through this conversation. The Clave SOL lives in the OS keychain; if it is missing, ask the user to run `sunat-cli keychain set SUNAT_PASSWORD` in a terminal. Never ask for it in chat.",
	"",
	"Several tools open a visible Chrome window on the user's machine and can take up to a few minutes. A result with found:false is an answer, not an error. Names, statuses and legal terms come back in Spanish as SUNAT writes them; keep them as they are.",
].join("\n");

/**
 * Tool calls run one at a time.
 *
 * The browser-driven commands share one agent-browser session and one set of
 * session files under ~/.sunat. A client that fires two calls in parallel
 * would have two children driving the same Chrome tab.
 */
function serialQueue() {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(job: () => Promise<T>): Promise<T> => {
		const next = tail.then(job, job);
		tail = next.catch(() => undefined);
		return next;
	};
}

/**
 * The SDK and zod are imported here, at call time, for the reason given on
 * `buildTools`: a static import would be hoisted into the single-file bundle
 * and paid by every command.
 */
export async function createMcpServer(
	version: string,
	run: typeof runCli = runCli,
): Promise<{ server: McpServer; toolCount: number }> {
	const [{ McpServer }, { z }] = await Promise.all([import("@modelcontextprotocol/sdk/server/mcp.js"), import("zod")]);
	const tools = buildTools(z);
	const server = new McpServer({ name: "sunat-cli", version }, { instructions: INSTRUCTIONS });
	const enqueue = serialQueue();

	const register = (tool: ToolDef) => {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: {
					readOnlyHint: tool.readOnly,
					destructiveHint: false,
					openWorldHint: tool.openWorld,
				},
			},
			async (args: unknown) => {
				let result: CliResult;
				try {
					const argv = buildArgv(z, tool, args);
					result = await enqueue(() => run(argv, { plainText: tool.plainText, timeoutMs: tool.timeoutMs }));
				} catch (err) {
					result = { ok: false, text: err instanceof Error ? err.message : String(err) };
				}
				return { content: [{ type: "text" as const, text: result.text }], isError: !result.ok };
			},
		);
	};

	for (const tool of tools) register(tool);
	return { server, toolCount: tools.length };
}

export async function startMcpServer(version: string): Promise<void> {
	const { server, toolCount } = await createMcpServer(version);
	const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
	await server.connect(new StdioServerTransport());
	// stderr, never stdout: stdout carries the protocol from here on.
	console.error(`sunat-cli MCP server v${version} ready on stdio (${toolCount} tools)`);
}
