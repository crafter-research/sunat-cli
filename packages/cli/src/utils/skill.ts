import { spawn } from "node:child_process";
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
		p.log.info("Skipped. Install later: npx skills add crafter-research/sunat-cli -g");
		return false;
	}

	try {
		// A missing `npx` surfaces as an async 'error' event here rather than a
		// throw, so the failure path is a rejected promise instead of the catch
		// arm reached under a synchronous spawn.
		const exitCode = await new Promise<number>((resolve, reject) => {
			const proc = spawn("npx", ["skills", "add", "crafter-research/sunat-cli", "-g"], {
				env: privateChildEnv(process.env, [
					"HTTPS_PROXY",
					"HTTP_PROXY",
					"NO_PROXY",
					"NPM_CONFIG_CAFILE",
					"NPM_CONFIG_REGISTRY",
					"NPM_CONFIG_STRICT_SSL",
				]),
				stdio: "inherit",
			});
			proc.on("error", reject);
			proc.on("close", (code) => resolve(code ?? 1));
		});
		return exitCode === 0;
	} catch {
		p.log.warn("npx skills not available. Install manually: npx skills add crafter-research/sunat-cli -g");
		return false;
	}
}
