import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { emitNextSteps } from "../utils/next-steps.ts";
import { output, outputError } from "../utils/output.ts";
import { packageDataDir } from "../utils/package-data.ts";
import { truncateVisible } from "../utils/style.ts";

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

const SKILLS_DIR = packageDataDir("skills");

/**
 * Si el usuario pidió JSON explícitamente.
 *
 * `skills get` sirve un documento markdown para leer, y un doc escapado dentro
 * de una cadena JSON no se lee, así que ahí el default es texto plano aunque no
 * haya TTY. Esa excepción vale para el documento, no para el listado: mirá
 * `listadoQuiereJson`.
 */
function quiereJson(): boolean {
	const a = process.argv;
	for (let i = 0; i < a.length; i++) {
		if ((a[i] === "-o" || a[i] === "--output") && a[i + 1] === "json") return true;
		if (a[i] === "--output=json") return true;
	}
	return false;
}

/**
 * El listado es una colección, no un documento, así que sigue la regla del
 * resto del CLI: JSON cuando stdout no es un terminal, aunque nadie pase `-o`.
 * Servía la tabla humana por una tubería, con las descripciones ya cortadas,
 * que es exactamente lo que un agente no puede parsear.
 */
function listadoQuiereJson(): boolean {
	return quiereJson() || !process.stdout.isTTY;
}

/** Primera línea con texto de un doc, para el listado. */
function resumen(md: string): string {
	for (const line of md.split("\n")) {
		const t = line.trim();
		if (t && !t.startsWith("#")) return t.replace(/`/g, "");
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
			const json = listadoQuiereJson();
			if (json) {
				output("json", { json: { skills: items } });
			} else {
				for (const s of items) console.log(`  ${s.name.padEnd(12)} ${truncateVisible(s.summary, 78)}`);
			}
			emitNextSteps(
				items.map((s) =>
					s.name === "core"
						? { command: "sunat-cli skills get core", description: "the usage guide" }
						: { command: `sunat-cli skills get ${s.name}`, description: `read ${s.name}`, optional: true },
				),
				json ? "json" : "table",
			);
		});

	skills
		.command("get <name>")
		.description("Print a document. 'core' is the usage guide.")
		.action((name: string) => {
			const file = join(SKILLS_DIR, `${name.replace(/[^a-z0-9-]/gi, "")}.md`);
			if (!existsSync(file)) {
				const disponibles = listar()
					.map((s) => s.name)
					.join(", ");
				outputError(`No existe "${name}". Disponibles: ${disponibles || "(ninguno)"}`, quiereJson() ? "json" : "table");
				return;
			}
			const content = readFileSync(file, "utf-8");
			if (quiereJson()) {
				output("json", { json: { name, content } });
				return;
			}
			console.log(content);
		});

	return skills;
}
