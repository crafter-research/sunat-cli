#!/usr/bin/env bun
import { Command } from "commander";
import { createApiCommand } from "../src/commands/api/index.ts";
import { createAuditCommand } from "../src/commands/audit.ts";
import { createCpeCommand } from "../src/commands/cpe/index.ts";
import { createF616Command } from "../src/commands/f616/index.ts";
import { createSkillsCommand } from "../src/commands/skills.ts";
import { createKeychainCommand } from "../src/commands/keychain.ts";
import { createLoginCommand } from "../src/commands/login.ts";
import { createPadronCommand } from "../src/commands/padron/index.ts";
import { createRentaCommand } from "../src/commands/renta/index.ts";
import { createRheCommand } from "../src/commands/rhe/index.ts";
import { createSchemaCommand } from "../src/commands/schema.ts";
import { createSireCommand } from "../src/commands/sire/index.ts";
import { createTipoCambioCommand } from "../src/commands/tipo-cambio.ts";
import { createWhoamiCommand } from "../src/commands/whoami.ts";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
	.name("sunat")
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

program.parse();
