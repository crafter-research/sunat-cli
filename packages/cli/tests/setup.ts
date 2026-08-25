/**
 * Test isolation. Loaded via `preload` in bunfig.toml, so it runs once per test
 * process before any test file imports `src/data/config.ts` and freezes its
 * paths.
 *
 * Both vars are set together on purpose. Tests that spawn the CLI as a child
 * pass `{ ...process.env, HOME: tempHome }` and assert against
 * `<tempHome>/.sunat`; if only SUNAT_HOME were set here it would be inherited
 * through that spread and win over the child's own HOME, sending state
 * somewhere the test does not look. Pointing HOME at the same scratch root
 * keeps that per-test override meaningful.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.SUNAT_HOME) {
	const root = mkdtempSync(join(tmpdir(), "sunat-test-home-"));
	process.env.HOME = root;
	process.env.SUNAT_HOME = join(root, ".sunat");
}
