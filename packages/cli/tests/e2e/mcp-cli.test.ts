import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = join(import.meta.dir, "..", "..", "bin", "sunat.ts");

/**
 * Drives `sunat-cli mcp` with a real MCP client over stdio.
 *
 * A successful handshake is itself the stdout-hygiene test: the transport
 * parses every stdout line as JSON-RPC, so a banner or a stray log on that
 * stream fails `connect` before any assertion runs.
 *
 * Only offline tools are called. Nothing here reaches SUNAT or opens a
 * browser, and HOME points at a scratch directory so the audit entries the
 * dry runs write do not land in a real ~/.sunat.
 */
describe("sunat-cli mcp", () => {
	let home: string;
	let client: Client;

	const text = (result: unknown): string =>
		(result as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? "";

	beforeAll(async () => {
		home = mkdtempSync(join(tmpdir(), "sunat-mcp-e2e-"));
		const env = Object.fromEntries(
			Object.entries({ ...process.env, HOME: home, SUNAT_HOME: join(home, ".sunat") }).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		client = new Client({ name: "sunat-cli-e2e", version: "0.0.0" });
		await client.connect(
			new StdioClientTransport({ command: "bun", args: ["run", CLI, "mcp"], env, stderr: "ignore" }),
		);
	});

	afterAll(async () => {
		await client.close();
		rmSync(home, { recursive: true, force: true });
	});

	test("announces itself and tells the model where it stops", () => {
		expect(client.getServerVersion()?.name).toBe("sunat-cli");
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("cannot perform a live SUNAT write");
		expect(instructions).toContain("Never ask for it in chat");
	});

	test("lists the curated tools with JSON schemas and hints", async () => {
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name);
		expect(names).toContain("sunat_doctor");
		expect(names).toContain("rhe_emit_preview");
		expect(names.length).toBeLessThanOrEqual(25);
		for (const t of tools) {
			expect(t.inputSchema.type).toBe("object");
			expect(t.annotations?.destructiveHint).toBe(false);
		}
		const emit = tools.find((t) => t.name === "rhe_emit_preview");
		expect(JSON.stringify(emit?.inputSchema)).toContain("dry_run");
	});

	test("a read tool returns the CLI's JSON", async () => {
		const result = await client.callTool({ name: "sunat_schema", arguments: { resource: "rhe" } });
		expect(result.isError).toBeFalsy();
		const doc = JSON.parse(text(result));
		expect(doc.command).toBe("rhe emit");
		expect(typeof doc.version).toBe("string");
	});

	test("the manual comes back as markdown, not a JSON string", async () => {
		const result = await client.callTool({ name: "sunat_guide", arguments: { topic: "core" } });
		expect(result.isError).toBeFalsy();
		expect(text(result).startsWith("# sunat-cli")).toBe(true);
	});

	test("an RHE dry run validates without emitting", async () => {
		const result = await client.callTool({
			name: "rhe_emit_preview",
			arguments: { params: { empresa: "Cliente Ejemplo", descripcion: "Servicio de prueba", monto: 100 } },
		});
		expect(result.isError).toBeFalsy();
		const doc = JSON.parse(text(result));
		expect(doc.dryRun).toBe(true);
		expect(doc.status).toBe("would-emit");
	});

	test("a failing command is a tool error and the server survives it", async () => {
		const failed = await client.callTool({
			name: "rhe_emit_preview",
			arguments: { params: { empresa: "Cliente Ejemplo", descripcion: "", monto: 100 } },
		});
		expect(failed.isError).toBe(true);
		expect(text(failed)).toContain("descripcion cannot be empty");

		const after = await client.callTool({ name: "sunat_whoami", arguments: {} });
		expect(after.isError).toBeFalsy();
		expect(JSON.parse(text(after))).toHaveProperty("sessions");
	});

	test("arguments that fail the schema never reach the CLI", async () => {
		const result = await client.callTool({ name: "padron_ruc", arguments: { ruc: "--help" } });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("RUC must be exactly 11 digits");
	});
});
