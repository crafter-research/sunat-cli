#!/usr/bin/env bun
import { Command } from "commander";
import { createApiCommand } from "../src/commands/api/index.ts";
import { createAuditCommand } from "../src/commands/audit.ts";
import { createCpeCommand } from "../src/commands/cpe/index.ts";
import { createF616Command } from "../src/commands/f616/index.ts";
import { createLoginCommand } from "../src/commands/login.ts";
import { createLukeaCommand } from "../src/commands/lukea/index.ts";
import { createPadronCommand } from "../src/commands/padron/index.ts";
import { createRheCommand } from "../src/commands/rhe/index.ts";
import { createSchemaCommand } from "../src/commands/schema.ts";
import { createSireCommand } from "../src/commands/sire/index.ts";
import { createTipoCambioCommand } from "../src/commands/tipo-cambio.ts";
import { createWhoamiCommand } from "../src/commands/whoami.ts";

const program = new Command();

program
	.name("sunat")
	.description("Agent-first CLI for SUNAT tax automation")
	.version("0.1.0")
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
program.addCommand(createApiCommand());
program.addCommand(createLukeaCommand());
program.addCommand(createCpeCommand());
program.addCommand(createPadronCommand());
program.addCommand(createSireCommand());
program.addCommand(createTipoCambioCommand());
program.addCommand(createAuditCommand());

program.parse();
