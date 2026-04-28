import type { CpeDriver, CpeDriverName } from "./types.ts";
import { MockDriver } from "./mock.ts";

export function getDriver(name: CpeDriverName | undefined): CpeDriver {
	const resolved = name || (process.env.CPE_DRIVER as CpeDriverName | undefined) || "mock";

	switch (resolved) {
		case "mock":
			return new MockDriver();
		case "facturador":
		case "sunat-direct":
		case "nubefact":
		case "apisperu":
			throw new Error(
				`Driver "${resolved}" is shaped but not implemented yet. See src/cpe/RESEARCH.md. Use --driver mock for now.`,
			);
		default:
			throw new Error(`Unknown driver: "${resolved}". Available: mock, facturador, sunat-direct, nubefact, apisperu.`);
	}
}

export { MockDriver };
export * from "./types.ts";
