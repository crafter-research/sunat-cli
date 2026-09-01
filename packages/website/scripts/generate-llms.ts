import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The website serves agent-facing docs from the CLI's own source of truth, the
// same manuals the binary prints with `sunat-cli skills get <topic>`. Generating
// them here means the published llms.txt can never drift from the shipped CLI.
const SKILLS = join(import.meta.dir, "..", "..", "cli", "src", "skills");
const OUT = join(import.meta.dir, "..", "public");

const SITE = "https://sunat-cli.crafter.ing";
const REPO = "https://github.com/crafter-research/sunat-cli";
const NPM = "https://www.npmjs.com/package/@crafter/sunat-cli";

// Reading order for the concatenated manual: the overview first, then the
// endpoints behind each command, then the field schemas.
const TOPICS = ["core", "endpoints", "schemas"];

function readTopic(topic: string): string {
	return readFileSync(join(SKILLS, `${topic}.md`), "utf8").trim();
}

function buildLlmsFull(): string {
	const header = `# sunat-cli — full documentation for LLMs

> SUNAT tax automation from the terminal, in Peru. Built for AI agents to operate and humans to supervise.

Generated from the CLI source of truth (packages/cli/src/skills), the same manuals
the binary serves with \`sunat-cli skills get <topic>\`. Do not edit by hand — run
\`bun run llms\` in packages/website to regenerate.

Repository: ${REPO}
Package: ${NPM}
Site: ${SITE}`;

	const body = TOPICS.map(readTopic).join("\n\n---\n\n");
	return `${header}\n\n---\n\n${body}\n`;
}

function buildLlms(): string {
	return `# sunat-cli

> SUNAT tax automation from the terminal, in Peru. Built for AI agents to operate and humans to supervise. One supervised CLI over ten SUNAT surfaces — RHE, F616, CPE, SIRE, Renta, Padrón, Buzón and tipo de cambio — with JSON output, runtime schema introspection and graded safety tiers.

Install with \`npm install -g @crafter/sunat-cli\`, then \`sunat-cli --help\`. The help output is the contract: every command it prints exists in the version you have. Runs on Node.

## Docs
- [Full documentation](${SITE}/llms-full.txt): the complete manual in one file — auth, every command surface, the SUNAT endpoint behind each command, and field schemas.
- [README](${REPO}/blob/main/README.md): install, quick start, the command table and safety tiers.
- [LIMITATIONS](${REPO}/blob/main/packages/cli/LIMITATIONS.md): the single source of truth for what does not work yet.

## Source
- [GitHub repository](${REPO})
- [npm package](${NPM})

## Notes
- Output is JSON whenever stdout is not a terminal, so an agent gets parseable data without passing a flag.
- \`sunat-cli schema <command>\` returns field specs at runtime, so an agent never parses \`--help\`.
- Every mutation is graded: T0 read-only, T1 writes locally, T2 files with SUNAT and requires \`--yes\`, T3 is irreversible.
`;
}

function main(): void {
	writeFileSync(join(OUT, "llms-full.txt"), buildLlmsFull());
	writeFileSync(join(OUT, "llms.txt"), buildLlms());
	console.log("Generated public/llms.txt and public/llms-full.txt");
}

main();
