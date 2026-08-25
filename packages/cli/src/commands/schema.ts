import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { getCpeCatalogosSchema } from "../cpe/catalogos/index.ts";
import { outputJSON } from "../utils/output.ts";
import { packageDataDir } from "../utils/package-data.ts";

const SCHEMAS_DIR = packageDataDir("schemas");

const AVAILABLE_SCHEMAS = [
	"rhe",
	"f616",
	"renta",
	"login",
	"cpe-factura",
	"cpe-boleta",
	"cpe-nota-credito",
	"cpe-catalogos",
] as const;

type SchemaName = (typeof AVAILABLE_SCHEMAS)[number];

// Contract version per resource, independent of the package version: it moves
// only when the described contract changes, so an agent diffing it does not
// see churn from unrelated releases. Bump on any field, flag or shape change.
const SCHEMA_VERSIONS: Record<SchemaName, string> = {
	rhe: "1.0.0",
	f616: "1.0.0",
	renta: "1.0.0",
	login: "1.0.0",
	"cpe-factura": "1.0.0",
	"cpe-boleta": "1.0.0",
	"cpe-nota-credito": "1.0.0",
	"cpe-catalogos": "1.0.0",
};

function withVersion(resource: SchemaName, schema: Record<string, unknown>): Record<string, unknown> {
	return { version: schema.version ?? SCHEMA_VERSIONS[resource], ...schema };
}

export function createSchemaCommand(): Command {
	return new Command("schema")
		.description("Introspect command schemas (agent self-service)")
		.argument("<resource>", `Resource to describe: ${AVAILABLE_SCHEMAS.join(", ")}`)
		.action((resource: string) => {
			if (resource === "login") {
				outputJSON(
					withVersion("login", {
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
					}),
				);
				return;
			}

			if (resource === "cpe-catalogos") {
				outputJSON(withVersion("cpe-catalogos", getCpeCatalogosSchema()));
				return;
			}

			const schemaPath = join(SCHEMAS_DIR, `${resource}.json`);
			try {
				const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
				outputJSON(withVersion(resource as SchemaName, schema));
			} catch {
				console.error(`Unknown schema: "${resource}". Available: ${AVAILABLE_SCHEMAS.join(", ")}`);
				process.exit(1);
			}
		});
}
