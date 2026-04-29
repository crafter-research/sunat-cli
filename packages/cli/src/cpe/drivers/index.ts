import type { CpeDriver, CpeDriverName } from "./types.ts";
import { MockDriver } from "./mock.ts";
import { SunatDirectDriver } from "./sunat-direct.ts";

export function getDriver(name: CpeDriverName | undefined): CpeDriver {
	const resolved = name || (process.env.CPE_DRIVER as CpeDriverName | undefined) || "mock";

	switch (resolved) {
		case "mock":
			return new MockDriver();
		case "sunat-direct":
			return new SunatDirectDriver();
		case "facturador":
		case "nubefact":
		case "apisperu":
			throw new Error(
				`Driver "${resolved}" is shaped but not implemented yet. See src/cpe/RESEARCH.md. Use --driver mock or --driver sunat-direct for now.`,
			);
		default:
			throw new Error(`Unknown driver: "${resolved}". Available: mock, sunat-direct, facturador, nubefact, apisperu.`);
	}
}

export { MockDriver, SunatDirectDriver };
export * from "./types.ts";
