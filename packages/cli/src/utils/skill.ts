import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { privateChildEnv } from "../data/child-process.ts";

const SKILL_DIR = join(process.env.HOME || "", ".claude", "skills", "sunat-cli");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");

export function isSkillInstalled(): boolean {
	return existsSync(SKILL_MD);
}

export async function installSkill(canPrompt: boolean): Promise<boolean> {
	if (!canPrompt) return false;

	const install = await p.confirm({
		message: "Install Claude Code skill? (lets AI agents use sunat-cli)",
	});

	if (p.isCancel(install) || !install) {
		p.log.info("Skipped. Install later: npx skills add Railly/sunat-cli -g");
		return false;
	}

	try {
		const proc = Bun.spawn(["npx", "skills", "add", "Railly/sunat-cli", "-g"], {
			env: privateChildEnv(process.env, [
				"HTTPS_PROXY",
				"HTTP_PROXY",
				"NO_PROXY",
				"NPM_CONFIG_CAFILE",
				"NPM_CONFIG_REGISTRY",
				"NPM_CONFIG_STRICT_SSL",
			]),
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
