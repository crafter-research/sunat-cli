#!/usr/bin/env bun
import { rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the artifact that npm installs.
 *
 * Bun is the dev runtime, but the published bin has to run for someone who only
 * has Node, so the entry is bundled with `--target=node` and re-shebanged.
 *
 * Dependencies stay external (`--packages=external`): they are real npm deps
 * that the installer already resolves, and bundling them would ship duplicates
 * of code npm is about to install anyway.
 */

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTRY = join(PKG_ROOT, "bin", "sunat.ts");
const OUT_DIR = join(PKG_ROOT, "dist");
const OUT_FILE = join(OUT_DIR, "sunat.js");
const NODE_SHEBANG = "#!/usr/bin/env node";

rmSync(OUT_DIR, { recursive: true, force: true });

const result = await Bun.build({
	entrypoints: [ENTRY],
	outdir: OUT_DIR,
	target: "node",
	packages: "external",
	naming: "sunat.js",
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

// Bun hoists the entry's own `#!/usr/bin/env bun` to line 1 of the bundle, so a
// `--banner` shebang would land underneath it and Node would parse the second
// one as a syntax error. Replacing line 1 is what actually leaves one shebang.
const bundled = await readFile(OUT_FILE, "utf-8");
const lines = bundled.split("\n");
if (lines[0]?.startsWith("#!")) {
	lines[0] = NODE_SHEBANG;
} else {
	lines.unshift(NODE_SHEBANG);
}

const output = lines.join("\n");
if (!output.startsWith(`${NODE_SHEBANG}\n`)) {
	console.error("build: expected the artifact to start with the node shebang");
	process.exit(1);
}
if (output.includes("#!/usr/bin/env bun")) {
	console.error("build: a bun shebang survived into the artifact");
	process.exit(1);
}

await writeFile(OUT_FILE, output, { mode: 0o755 });

console.log(`built ${OUT_FILE}`);
