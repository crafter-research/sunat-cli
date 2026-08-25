// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	site: "https://sunat-cli.crafter.ing",
	i18n: {
		locales: ["es", "en"],
		defaultLocale: "es",
		routing: {
			// Spanish is the audience's language and lives at the root.
			// English gets the /en prefix.
			prefixDefaultLocale: false,
		},
	},
});
