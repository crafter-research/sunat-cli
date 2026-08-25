import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { getCpeCatalogosSchema } from "../cpe/catalogos/index.ts";
import { isHumanFormat, outputJSON, outputTable } from "../utils/output.ts";
import { packageDataDir } from "../utils/package-data.ts";
import { bold, danger, dim, muted, truncateVisible } from "../utils/style.ts";

/**
 * A person asking for a schema wants to know which fields exist, which are
 * mandatory and what shape they take. Printing the contract verbatim answers
 * that, but only after the reader parses braces by eye.
 *
 * The machine contract is untouched: this branch runs only on a terminal, and
 * `-o json` or a pipe still emits the exact document an agent parses.
 */
function renderSchema(doc: Record<string, unknown>): void {
	const version = typeof doc.version === "string" ? doc.version : "?";
	const command = typeof doc.command === "string" ? doc.command : "";
	const description = typeof doc.description === "string" ? doc.description : "";

	console.log(`${bold(command || "schema")}  ${muted(`contract v${version}`)}`);
	if (description) console.log(dim(`  ${description}`));

	const fields = doc.fields as Record<string, Record<string, unknown>> | undefined;
	if (!fields || Object.keys(fields).length === 0) {
		console.log();
		console.log(muted("This resource carries no field table. Use -o json to read it whole."));
		return;
	}

	console.log();
	const rows = Object.entries(fields).map(([name, spec]) => {
		const required = spec?.required === true;
		const def = spec?.default;
		return [
			required ? danger("*") : dim(" "),
			name,
			String(spec?.type ?? "-"),
			def === undefined ? dim("-") : String(def),
			muted(truncateVisible(String(spec?.description ?? ""), 52)),
		];
	});
	outputTable(["", "Field", "Type", "Default", "Description"], rows);
	console.log();
	console.log(
		dim(`  ${danger("*")} required · full contract: sunat-cli schema ${command.split(" ")[0] || ""} -o json`),
	);
}

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
		.action(function (this: Command, resource: string) {
			const fmt = () => (this.parent?.opts().output as string | undefined) ?? "auto";
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
				{
					const doc = withVersion("cpe-catalogos", getCpeCatalogosSchema());
					if (isHumanFormat(fmt())) renderSchema(doc as Record<string, unknown>);
					else outputJSON(doc);
				}
				return;
			}

			const schemaPath = join(SCHEMAS_DIR, `${resource}.json`);
			try {
				const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
				{
					const doc = withVersion(resource as SchemaName, schema);
					if (isHumanFormat(fmt())) renderSchema(doc as Record<string, unknown>);
					else outputJSON(doc);
				}
			} catch {
				console.error(`Unknown schema: "${resource}". Available: ${AVAILABLE_SCHEMAS.join(", ")}`);
				process.exit(1);
			}
		});
}
