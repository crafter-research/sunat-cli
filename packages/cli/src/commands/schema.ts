import { Command } from "commander";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { getCpeCatalogosSchema } from "../cpe/catalogos/index.ts";
import { outputJSON } from "../utils/output.ts";

const SCHEMAS_DIR = join(dirname(import.meta.dir), "schemas");

const AVAILABLE_SCHEMAS = [
	"rhe",
	"f616",
	"login",
	"cpe-factura",
	"cpe-boleta",
	"cpe-nota-credito",
	"cpe-catalogos",
] as const;

export function createSchemaCommand(): Command {
	return new Command("schema")
		.description("Introspect command schemas (agent self-service)")
		.argument("<resource>", `Resource to describe: ${AVAILABLE_SCHEMAS.join(", ")}`)
		.action((resource: string) => {
			if (resource === "login") {
				outputJSON({
					command: "login",
					description: "Authenticate with SUNAT Clave SOL",
					auth: {
						envVars: {
							SUNAT_RUC: "RUC number (11 digits)",
							SUNAT_USER: "SOL username",
							SUNAT_PASSWORD: "SOL password",
						},
						portals: {
							sol: { url: "e-menu.sunat.gob.pe/cl-ti-itmenu/", captcha: "NONE", use: "RHE emission" },
							nuevaPlataforma: {
								url: "e-menu.sunat.gob.pe/cl-ti-itmenu2/",
								captcha: "reCAPTCHA v2",
								use: "F616 declaration",
							},
						},
					},
					flags: { "--nueva-plataforma": "Login to Nueva Plataforma (requires reCAPTCHA)" },
				});
				return;
			}

			if (resource === "cpe-catalogos") {
				outputJSON(getCpeCatalogosSchema());
				return;
			}

			const schemaPath = join(SCHEMAS_DIR, `${resource}.json`);
			try {
				const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
				outputJSON(schema);
			} catch {
				console.error(`Unknown schema: "${resource}". Available: ${AVAILABLE_SCHEMAS.join(", ")}`);
				process.exit(1);
			}
		});
}
