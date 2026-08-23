import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const SKILLS_DIR = join(import.meta.dir, "..", "..", "src", "skills");

describe("documentación servida por el CLI", () => {
	test("existe el directorio", () => {
		expect(existsSync(SKILLS_DIR)).toBe(true);
	});

	test("core.md está, es el punto de entrada al que apunta el stub", () => {
		expect(existsSync(join(SKILLS_DIR, "core.md"))).toBe(true);
	});

	test("ningún doc lleva frontmatter", () => {
		// El frontmatter es del stub instalado, no del contenido servido:
		// imprimirlo confundiría a un agente que ya cargó el skill.
		for (const f of readdirSync(SKILLS_DIR).filter((x) => x.endsWith(".md"))) {
			expect(readFileSync(join(SKILLS_DIR, f), "utf-8").startsWith("---")).toBe(false);
		}
	});

	test("ningún doc queda vacío", () => {
		for (const f of readdirSync(SKILLS_DIR).filter((x) => x.endsWith(".md"))) {
			expect(readFileSync(join(SKILLS_DIR, f), "utf-8").trim().length).toBeGreaterThan(200);
		}
	});

	test("core no manda a archivos que ya no existen", () => {
		// Las referencias vivían en references/*.md antes de moverse acá.
		expect(readFileSync(join(SKILLS_DIR, "core.md"), "utf-8")).not.toContain("references/");
	});

	test("core no documenta los campos que el código ignora", () => {
		// ingresoPEN y retenciones están en el schema y el código los descarta:
		// documentarlos como entrada manda a construir payloads que no hacen nada.
		const core = readFileSync(join(SKILLS_DIR, "core.md"), "utf-8");
		const enBloqueDeUso = core.split("**The older `f616 declare`**")[0];
		expect(enBloqueDeUso).not.toContain('"ingresoPEN":');
	});
});

describe("selección de formato", () => {
	// El programa reescribe "auto" a "json" sin TTY, y estos comandos sirven
	// markdown: sale texto plano salvo que el usuario pida json en argv.
	const quiereJson = (argv: string[]): boolean => {
		for (let i = 0; i < argv.length; i++) {
			if ((argv[i] === "-o" || argv[i] === "--output") && argv[i + 1] === "json") return true;
			if (argv[i] === "--output=json") return true;
		}
		return false;
	};

	test("sin flag, texto plano", () => {
		expect(quiereJson(["sunat", "skills", "get", "core"])).toBe(false);
	});

	test("reconoce las tres formas de pedir json", () => {
		expect(quiereJson(["sunat", "--output", "json", "skills", "list"])).toBe(true);
		expect(quiereJson(["sunat", "-o", "json", "skills", "list"])).toBe(true);
		expect(quiereJson(["sunat", "--output=json", "skills", "list"])).toBe(true);
	});

	test("otro formato no cuenta como json", () => {
		expect(quiereJson(["sunat", "--output", "table", "skills", "list"])).toBe(false);
	});
});
