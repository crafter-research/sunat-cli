import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildArgv, buildTools, LIVE_FLAGS } from "../../src/mcp/tools.ts";

const tools = buildTools(z);
const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	if (!found) throw new Error(`no tool named ${name}`);
	return found;
};

describe("MCP tool catalogue", () => {
	test("tool names are unique and snake_case", () => {
		const names = tools.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
	});

	test("every tool describes itself", () => {
		for (const t of tools) {
			expect(t.title.length).toBeGreaterThan(0);
			expect(t.description.length).toBeGreaterThan(40);
		}
	});

	test("maps arguments to the CLI command line a person would type", () => {
		expect(buildArgv(z, tool("sunat_doctor"), {})).toEqual(["doctor"]);
		expect(buildArgv(z, tool("sunat_schema"), { resource: "cpe-factura" })).toEqual(["schema", "cpe-factura"]);
		expect(buildArgv(z, tool("tipo_cambio"), { fecha: "2026-11-13" })).toEqual(["tipo-cambio", "--fecha=2026-11-13"]);
		expect(buildArgv(z, tool("padron_ruc"), { ruc: "20100070970" })).toEqual(["padron", "ruc", "20100070970"]);
		expect(buildArgv(z, tool("padron_ruc"), { ruc: "20100070970", source: "online" })).toEqual([
			"padron",
			"ruc-online",
			"20100070970",
		]);
		expect(buildArgv(z, tool("sunat_login"), {})).toEqual(["login"]);
		expect(buildArgv(z, tool("sunat_login"), { portal: "nueva-plataforma" })).toEqual(["login", "--nueva-plataforma"]);
		expect(buildArgv(z, tool("sunat_login"), { portal: "renta" })).toEqual(["renta", "login"]);
	});

	test("the RHE tool can only validate or preview", () => {
		const params = { empresa: "Cliente", descripcion: "Servicio", monto: 100 };
		expect(buildArgv(z, tool("rhe_emit_preview"), { params })).toEqual([
			"rhe",
			"emit",
			`--params=${JSON.stringify(params)}`,
			"--dry-run",
		]);
		expect(buildArgv(z, tool("rhe_emit_preview"), { params, mode: "preview" }).at(-1)).toBe("--preview-only");
		expect(() => buildArgv(z, tool("rhe_emit_preview"), { params, mode: "live" })).toThrow();
	});

	test("the F616 tool always carries --dry-run", () => {
		const argv = buildArgv(z, tool("f616_declare_dry_run"), { params: { periodo: "2026-10" } });
		expect(argv).toContain("--dry-run");
	});

	// The server's whole write posture rests on this: whatever a model sends,
	// the command line that reaches the CLI never carries an acknowledgement
	// flag as its own argv entry, which is the only form Commander honours.
	test("no argument can inject a live-write flag", () => {
		const hostile = ["--yes", "--live-sunat", "-y", "--help", "--force", "x --yes", "--yes=true"];
		for (const t of tools) {
			const keys = Object.keys(t.inputSchema);
			for (const value of hostile) {
				const args = Object.fromEntries(keys.map((k) => [k, k === "params" ? { [value]: value } : value]));
				let argv: string[];
				try {
					argv = buildArgv(z, t, args);
				} catch {
					continue;
				}
				for (const flag of LIVE_FLAGS) expect(argv).not.toContain(flag);
				for (const entry of argv.slice(1)) {
					if (entry.startsWith("-")) expect(entry).toMatch(/^--[a-z-]+(=|$)/);
				}
			}
		}
	});

	test("positionals reject anything that could read as a flag", () => {
		expect(() => buildArgv(z, tool("padron_ruc"), { ruc: "--help" })).toThrow();
		expect(() => buildArgv(z, tool("f616_periodo"), { periodo: "--yes" })).toThrow();
		expect(() => buildArgv(z, tool("sunat_schema"), { resource: "--yes" })).toThrow();
		expect(() => buildArgv(z, tool("sunat_guide"), { topic: "../../etc/passwd" })).toThrow();
	});

	test("no tool accepts a password", () => {
		for (const t of tools) {
			for (const key of Object.keys(t.inputSchema)) expect(key.toLowerCase()).not.toMatch(/pass|clave|secret|token/);
		}
	});

	test("a tool that somehow built a live flag is refused", () => {
		const rogue = { ...tool("sunat_doctor"), argv: () => ["rhe", "emit", "--yes"] };
		expect(() => buildArgv(z, rogue, {})).toThrow(/not allowed over MCP/);
	});
});
