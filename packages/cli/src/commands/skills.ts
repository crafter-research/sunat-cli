import { Command } from "commander";
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { output, outputError } from "../utils/output.ts";

/**
 * Sirve la documentación del CLI desde el propio binario.
 *
 * El skill instalado es un stub de descubrimiento que apunta acá. La ventaja
 * es que el contenido no se desincroniza: lo que un agente lee siempre
 * corresponde a la versión instalada, no a la que había cuando se copió el
 * skill a `~/.claude/skills/`.
 *
 * Mismo patrón que `agent-browser skills get core`.
 */

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

/**
 * Si el usuario pidió JSON explícitamente.
 *
 * No sirve mirar `--output`: el programa reescribe "auto" a "json" cuando no
 * hay TTY, y estos comandos sirven markdown para leer. Un doc escapado dentro
 * de una cadena JSON no se lee, así que el default es texto plano y JSON solo
 * cuando aparece en argv.
 */
function quiereJson(): boolean {
	const a = process.argv;
	for (let i = 0; i < a.length; i++) {
		if ((a[i] === "-o" || a[i] === "--output") && a[i + 1] === "json") return true;
		if (a[i] === "--output=json") return true;
	}
	return false;
}

/** Primera línea con texto de un doc, para el listado. */
function resumen(md: string): string {
	for (const line of md.split("\n")) {
		const t = line.trim();
		if (t && !t.startsWith("#")) return t.replace(/`/g, "").slice(0, 78);
	}
	return "";
}

function listar(): Array<{ name: string; summary: string }> {
	if (!existsSync(SKILLS_DIR)) return [];
	return readdirSync(SKILLS_DIR)
		.filter((f) => f.endsWith(".md"))
		.map((f) => ({ name: f.replace(/\.md$/, ""), summary: resumen(readFileSync(join(SKILLS_DIR, f), "utf-8")) }))
		.sort((a, b) => (a.name === "core" ? -1 : b.name === "core" ? 1 : a.name.localeCompare(b.name)));
}

export function createSkillsCommand(): Command {
	const skills = new Command("skills").description(
		"Serve this CLI's own docs, always matching the installed version. Start with 'skills get core'. T0.",
	);

	skills
		.command("list")
		.description("What documentation this version ships")
		.action(() => {
			const items = listar();
			if (quiereJson()) { output("json", { json: { skills: items } }); return; }
			for (const s of items) console.log(`  ${s.name.padEnd(12)} ${s.summary}`);
		});

	skills
		.command("get <name>")
		.description("Print a document. 'core' is the usage guide.")
		.action((name: string) => {
			const file = join(SKILLS_DIR, `${name.replace(/[^a-z0-9-]/gi, "")}.md`);
			if (!existsSync(file)) {
				const disponibles = listar().map((s) => s.name).join(", ");
				outputError(`No existe "${name}". Disponibles: ${disponibles || "(ninguno)"}`, quiereJson() ? "json" : "table");
				return;
			}
			const content = readFileSync(file, "utf-8");
			if (quiereJson()) { output("json", { json: { name, content } }); return; }
			console.log(content);
		});

	return skills;
}
