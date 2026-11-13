import { Command } from "commander";
import { startMcpServer } from "../mcp/server.ts";

/**
 * `sunat-cli mcp` serves the CLI to MCP clients (Claude Desktop, Claude Code,
 * Cursor and others) over stdio.
 *
 * It exists for clients that have no shell. An agent with a terminal is still
 * better served by the commands themselves plus `sunat-cli skills get core`;
 * this is the same surface for one that can only call tools.
 *
 * The MCP SDK and zod are loaded only when this command runs; see
 * `createMcpServer` for how that survives the single-file bundle.
 */
export function createMcpCommand(version: string): Command {
	return new Command("mcp")
		.description(
			"Start an MCP server on stdio for Claude Desktop, Claude Code, Cursor and other MCP clients. Read-only and preview tools; live SUNAT writes stay on the CLI.",
		)
		.action(async () => {
			await startMcpServer(version);
		});
}
