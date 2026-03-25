import { Command } from "commander";
import { outputError } from "../../utils/output.ts";

export function createF616Command(): Command {
	const f616 = new Command("f616").description("Formulario Virtual 616 monthly declaration");

	f616
		.command("declare")
		.description("File F616 monthly tax declaration")
		.option("--json <payload>", "JSON payload with F616 data")
		.option("--batch", "Process multiple months")
		.option("--months <range>", "Month range (e.g. 2025-03..2026-02)")
		.option("--dry-run", "Preview without submitting")
		.action((_, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			outputError("F616 declaration not implemented yet. Phase 4.", format);
		});

	f616
		.command("status")
		.description("Check F616 declaration status")
		.action((_, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			outputError("F616 status not implemented yet.", format);
		});

	return f616;
}
