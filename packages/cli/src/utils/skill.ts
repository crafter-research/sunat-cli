import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";

const SKILL_DIR = join(process.env.HOME || "", ".claude", "skills", "sunat-cli");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");

export function isSkillInstalled(): boolean {
	return existsSync(SKILL_MD);
}

export async function installSkill(isTTY: boolean): Promise<boolean> {
	if (!isTTY) return false;

	const install = await p.confirm({
		message: "Install Claude Code skill? (lets AI agents use sunat-cli)",
	});

	if (p.isCancel(install) || !install) {
		p.log.info("Skipped. Install later: npx skills add Railly/sunat-cli -g");
		return false;
	}

	try {
		const proc = Bun.spawn(["npx", "skills", "add", "Railly/sunat-cli", "-g"], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		p.log.warn("npx skills not available. Install manually: npx skills add Railly/sunat-cli -g");
		return false;
	}
}
