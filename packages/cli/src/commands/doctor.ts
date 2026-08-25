import { existsSync } from "node:fs";
import { Command } from "commander";
import { probeAgentBrowser } from "../browser/dependency.ts";
import { paths } from "../data/config.ts";
import { isHumanFormat, output } from "../utils/output.ts";
import { danger, dim, muted, ok, warn } from "../utils/style.ts";

type Check = {
	name: string;
	ok: boolean;
	required: boolean;
	detail: string;
	hint?: string;
};

function checks(): Check[] {
	const ab = probeAgentBrowser();
	const configured = existsSync(paths.config);

	return [
		{
			name: "agent-browser",
			ok: ab.installed,
			required: false,
			detail: ab.installed ? (ab.version ?? "installed") : "not on PATH",
			hint: ab.installed ? undefined : ab.hint,
		},
		{
			name: "node",
			ok: true,
			required: true,
			detail: process.version,
		},
		{
			name: "config",
			ok: configured,
			required: false,
			detail: configured ? paths.config : "not created yet",
			hint: configured ? undefined : "Run: sunat-cli login",
		},
	];
}

export function createDoctorCommand(): Command {
	return new Command("doctor")
		.description("Check what this CLI needs to run: dependencies, config, sessions. T0.")
		.action(function (this: Command) {
			const format = this.parent?.opts().output || "auto";
			const results = checks();
			const failed = results.filter((c) => !c.ok);
			const blocking = failed.filter((c) => c.required);

			if (isHumanFormat(format)) {
				const glyph = blocking.length > 0 ? danger("●") : failed.length > 0 ? warn("●") : ok("●");
				const verdict =
					blocking.length > 0
						? "cannot run"
						: failed.length > 0
							? `ready, ${failed.length} optional ${failed.length === 1 ? "piece" : "pieces"} missing`
							: "ready";
				console.log(`${glyph} sunat-cli ${verdict}`);
				console.log();
				for (const c of results) {
					const mark = c.ok ? ok("✓") : c.required ? danger("✗") : warn("○");
					console.log(`  ${mark} ${c.name.padEnd(15)} ${muted(c.detail)}`);
					if (c.hint) {
						for (const line of c.hint.split("\n")) console.log(dim(`      ${line}`));
					}
				}
				return;
			}

			output(format, {
				json: {
					ok: blocking.length === 0,
					checks: results.map((c) => ({
						name: c.name,
						ok: c.ok,
						required: c.required,
						detail: c.detail,
						...(c.hint ? { hint: c.hint } : {}),
					})),
				},
			});
		});
}
