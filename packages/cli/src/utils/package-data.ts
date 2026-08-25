import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates a data directory that ships inside the package (`src/schemas`,
 * `src/skills`).
 *
 * Two layouts have to resolve from one expression. From source this module sits
 * in `src/utils/`, so the data is a sibling under `src/`. In the published build
 * everything is bundled into `dist/sunat.js`, so `import.meta.url` points at
 * `dist/` and the same data is one level up under `src/`.
 *
 * `src/<name>` is tried before a bare `<name>` at every level on purpose: the
 * package root ships an unrelated top-level `skills/` (the Claude skill stub),
 * and from `dist/` a bare match would find that one instead of `src/skills`.
 */
export function packageDataDir(name: string): string {
	const start = dirname(fileURLToPath(import.meta.url));
	let dir = start;

	for (let i = 0; i < 5; i++) {
		for (const candidate of [join(dir, "src", name), join(dir, name)]) {
			if (existsSync(candidate)) return candidate;
		}

		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return join(start, name);
}
