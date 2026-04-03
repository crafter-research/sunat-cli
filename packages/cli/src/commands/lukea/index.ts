import { Command } from "commander";
import { createLukeaLoginCommand } from "./login.ts";
import { createLukeaWhoamiCommand } from "./whoami.ts";
import { createLukeaStatusCommand } from "./status.ts";
import { createLukeaJobsCommand } from "./jobs.ts";
import { createLukeaDisconnectCommand } from "./disconnect.ts";

export function createLukeaCommand(): Command {
	const lukea = new Command("lukea").description("Conectar sunat-cli con Lukea (compliance autopilot)");

	lukea.addCommand(createLukeaLoginCommand());
	lukea.addCommand(createLukeaWhoamiCommand());
	lukea.addCommand(createLukeaStatusCommand());
	lukea.addCommand(createLukeaJobsCommand());
	lukea.addCommand(createLukeaDisconnectCommand());

	return lukea;
}
