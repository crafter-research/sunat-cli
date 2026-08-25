#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { createApiCommand } from "../src/commands/api/index.ts";
import { createAuditCommand } from "../src/commands/audit.ts";
import { createCpeCommand } from "../src/commands/cpe/index.ts";
import { createF616Command } from "../src/commands/f616/index.ts";
import { createKeychainCommand } from "../src/commands/keychain.ts";
import { createLoginCommand } from "../src/commands/login.ts";
import { createPadronCommand } from "../src/commands/padron/index.ts";
import { createRentaCommand } from "../src/commands/renta/index.ts";
import { createRheCommand } from "../src/commands/rhe/index.ts";
import { createDoctorCommand } from "../src/commands/doctor.ts";
import { createSchemaCommand } from "../src/commands/schema.ts";
import { createSireCommand } from "../src/commands/sire/index.ts";
import { createSkillsCommand } from "../src/commands/skills.ts";
import { createTipoCambioCommand } from "../src/commands/tipo-cambio.ts";
import { createWhoamiCommand } from "../src/commands/whoami.ts";
import { printBanner } from "../src/utils/banner.ts";

const program = new Command();

/**
 * The banner belongs to the two screens a person reads before running anything:
 * bare invoke and `--help`. Putting it on every command would tax each
 * invocation of a CLI whose main caller is an agent.
 */
function wantsBanner(argv: string[]): boolean {
	const args = argv.slice(2);
	if (args.length === 0) return true;
	if (args.some((a) => a === "-o" || a === "--output" || a.startsWith("--output="))) return false;
	return args.every((a) => a === "help" || a === "-h" || a === "--help");
}

program
	.name("sunat-cli")
	.description("Agent-first CLI for SUNAT tax automation")
	.version(pkg.version)
	.option("-o, --output <format>", "output format", "auto")
	.hook("preAction", (thisCommand) => {
		const opts = thisCommand.opts();
		if (opts.output === "auto") {
			opts.output = process.stdout.isTTY ? "table" : "json";
		}
	});

program.addCommand(createLoginCommand());
program.addCommand(createWhoamiCommand());
program.addCommand(createSchemaCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createRheCommand());
program.addCommand(createF616Command());
program.addCommand(createSkillsCommand());
program.addCommand(createKeychainCommand());
program.addCommand(createApiCommand());
program.addCommand(createCpeCommand());
program.addCommand(createPadronCommand());
program.addCommand(createRentaCommand());
program.addCommand(createSireCommand());
program.addCommand(createTipoCambioCommand());
program.addCommand(createAuditCommand());

if (wantsBanner(process.argv)) {
	printBanner({ version: pkg.version, tagline: "Agent-first CLI for SUNAT tax automation" });
}

program.parse();
