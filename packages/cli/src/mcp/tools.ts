import type { z as Zod } from "zod";
import { AVAILABLE_SCHEMAS } from "../commands/schema.ts";

/**
 * The MCP tool catalogue.
 *
 * Every tool is a thin, typed front for one CLI invocation: `argv` turns the
 * validated arguments into the exact command line a person would type, and the
 * server runs that line in a child process. Nothing here calls a workflow
 * directly. The gates that make this CLI safe to hand to an agent (input
 * hardening, `--dry-run`, `--yes --live-sunat`, the audit log) live in the
 * command handlers, so going through the command line is what keeps an MCP
 * call under the same rules as a shell call.
 *
 * The catalogue is curated rather than generated from Commander. The CLI has
 * about a hundred subcommands; a model choosing among a hundred tools chooses
 * badly, and a generated mirror would expose every write path by default.
 *
 * Write posture for this server: no tool can perform a live SUNAT write.
 * Tools that sit in front of a mutating command pin it to its local
 * validation or preview mode, and `LIVE_FLAGS` below is checked on every
 * built command line as a second lock. Live emission stays on the CLI, where
 * the operator types the acknowledgement flags themselves.
 */

/** Flags that turn a previewed operation into a real SUNAT write. */
export const LIVE_FLAGS = ["--yes", "--live-sunat"] as const;

export type ToolDef = {
	name: string;
	title: string;
	description: string;
	inputSchema: Zod.ZodRawShape;
	/** True when the call cannot change anything at SUNAT or on disk beyond caches. */
	readOnly: boolean;
	/** True when the call reaches SUNAT (network or browser) rather than only local state. */
	openWorld: boolean;
	/** Markdown documents are returned as text, so they skip `-o json`. */
	plainText?: boolean;
	/** Browser-driven commands need far longer than a local read. */
	timeoutMs?: number;
	// biome-ignore lint/suspicious/noExplicitAny: each tool's args are validated by its own inputSchema before argv runs
	argv: (args: any) => string[];
};

const BROWSER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Optional values travel as `--flag=value`, never as two argv entries. With
 * the joined form Commander cannot read a value that happens to start with a
 * dash as another flag, so a string argument can never smuggle one in.
 */
function opt(flag: string, value: string | number | undefined): string[] {
	return value === undefined ? [] : [`${flag}=${value}`];
}

/**
 * Builds the catalogue with the zod instance the caller loaded.
 *
 * zod arrives as an argument instead of a top-level import because the
 * published CLI is one bundled file with its dependencies left external
 * (see scripts/build.ts). A static import here would be hoisted to the top of
 * that file and make every `sunat-cli` invocation load zod, not only `mcp`.
 */
export function buildTools(z: typeof Zod): ToolDef[] {
	const ruc = z.string().regex(/^\d{11}$/, "RUC must be exactly 11 digits");
	const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
	const sunatDate = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Expected DD/MM/YYYY");
	const periodoDash = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
	const periodoCompact = z.string().regex(/^\d{6}$/, "Expected YYYYMM");
	const ejercicio = z.string().regex(/^\d{4}$/, "Expected a four-digit year");
	const payload = z.record(z.string(), z.unknown());

	return [
		{
			name: "sunat_doctor",
			title: "Check setup",
			description:
				"Report what this machine has and lacks for sunat-cli: Node, agent-browser, config, sessions, and the command that fixes each gap. Call this first in a new conversation.",
			inputSchema: {},
			readOnly: true,
			openWorld: false,
			argv: () => ["doctor"],
		},
		{
			name: "sunat_whoami",
			title: "Session status",
			description:
				"Show the configured RUC and usuario and whether the SOL and Nueva Plataforma sessions are active or stale. Sessions expire after about 20 minutes.",
			inputSchema: {},
			readOnly: true,
			openWorld: false,
			argv: () => ["whoami"],
		},
		{
			name: "sunat_login",
			title: "Sign in to SUNAT",
			description:
				"Open a SUNAT session with the credentials already stored on this machine. Opens a visible Chrome window for 'sol' and 'nueva-plataforma'. There is deliberately no password argument: the Clave SOL is read from the OS keychain or SUNAT_PASSWORD. If it is missing, ask the user to run `sunat-cli keychain set SUNAT_PASSWORD` in a terminal. Never ask the user to paste their password into the chat.",
			inputSchema: {
				portal: z
					.enum(["sol", "nueva-plataforma", "renta"])
					.default("sol")
					.describe(
						"sol: RHE, Buzón, declaraciones. nueva-plataforma: F616. renta: annual income tax (F709) token, valid one hour.",
					),
			},
			readOnly: false,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: ({ portal }: { portal: "sol" | "nueva-plataforma" | "renta" }) =>
				portal === "renta"
					? ["renta", "login"]
					: portal === "nueva-plataforma"
						? ["login", "--nueva-plataforma"]
						: ["login"],
		},
		{
			name: "sunat_guide",
			title: "Read the manual",
			description:
				"Return the manual that ships with the installed version, as markdown. 'core' covers auth, RHE, F616 and workflows; 'schemas' the field specs; 'endpoints' the SUNAT endpoint behind each command. Read 'core' before a first RHE or F616 task.",
			inputSchema: { topic: z.enum(["core", "schemas", "endpoints"]).default("core") },
			readOnly: true,
			openWorld: false,
			plainText: true,
			argv: ({ topic }: { topic: string }) => ["skills", "get", topic],
		},
		{
			name: "sunat_schema",
			title: "Describe a payload",
			description:
				"Return the versioned field contract for a payload: which fields exist, which are required, their types and limits. Call this before building `params` for rhe_emit_preview, f616_declare_dry_run or cpe_preview instead of guessing field names.",
			inputSchema: { resource: z.enum(AVAILABLE_SCHEMAS) },
			readOnly: true,
			openWorld: false,
			argv: ({ resource }: { resource: string }) => ["schema", resource],
		},
		{
			name: "tipo_cambio",
			title: "Official exchange rate",
			description:
				"Official SUNAT USD/PEN exchange rate (compra and venta) for a date, default today. Cached locally per date because a published rate never changes.",
			inputSchema: { fecha: isoDate.optional().describe("YYYY-MM-DD, defaults to today in Peru") },
			readOnly: true,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: ({ fecha }: { fecha?: string }) => ["tipo-cambio", ...opt("--fecha", fecha)],
		},
		{
			name: "padron_ruc",
			title: "Look up a RUC",
			description:
				"Look up a taxpayer by RUC: razón social, estado, condición, address. 'local' reads the downloaded padrón reducido (fast, needs `sunat-cli padron sync` once, about 370 MB). 'online' asks the SUNAT portal through a browser (5 to 10 seconds, no sync needed). A result with found:false is a definitive answer, not an error.",
			inputSchema: {
				ruc,
				source: z.enum(["local", "online"]).default("local"),
			},
			readOnly: true,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: ({ ruc, source }: { ruc: string; source: "local" | "online" }) => [
				"padron",
				source === "online" ? "ruc-online" : "ruc",
				ruc,
			],
		},
		{
			name: "cpe_consulta",
			title: "Validate a comprobante",
			description:
				"Check any electronic comprobante (yours or a supplier's) against SUNAT's records through the REST API. Needs OAuth API credentials configured; sunat_doctor says whether they are.",
			inputSchema: {
				rucEmisor: ruc.describe("RUC of the issuer"),
				tipo: z
					.enum(["01", "03", "07", "08", "09", "20", "40"])
					.describe(
						"01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito, 09 guía, 20 retención, 40 percepción",
					),
				serie: z
					.string()
					.regex(/^[A-Za-z0-9]{1,4}$/, "Expected a serie such as F001")
					.describe("e.g. F001"),
				numero: z
					.string()
					.regex(/^\d{1,8}$/, "Expected the correlativo as digits")
					.describe("Correlativo"),
				fecha: isoDate.describe("Fecha de emisión, YYYY-MM-DD"),
				monto: z
					.number()
					.positive()
					.optional()
					.describe("Total; when given it must match SUNAT's record to two decimals"),
				rucConsultante: ruc.optional().describe("RUC of who is asking; defaults to the active profile"),
			},
			readOnly: true,
			openWorld: true,
			argv: (a: {
				rucEmisor: string;
				tipo: string;
				serie: string;
				numero: string;
				fecha: string;
				monto?: number;
				rucConsultante?: string;
			}) => [
				"cpe",
				"consulta",
				...opt("--ruc-emisor", a.rucEmisor),
				...opt("--tipo", a.tipo),
				...opt("--serie", a.serie),
				...opt("--numero", a.numero),
				...opt("--fecha", a.fecha),
				...opt("--monto", a.monto),
				...opt("--ruc-consultante", a.rucConsultante),
			],
		},
		{
			name: "cpe_preview",
			title: "Preview a factura or boleta",
			description:
				"Build, sign and validate a factura or boleta locally and return the result with its hash. Nothing is sent to SUNAT. Read sunat_schema 'cpe-factura' or 'cpe-boleta' for the payload. Emitting the document is not available over MCP: the user runs `sunat-cli cpe factura emit` in a terminal.",
			inputSchema: {
				tipo: z.enum(["factura", "boleta"]),
				params: payload.describe("The comprobante payload, as described by sunat_schema"),
			},
			readOnly: true,
			openWorld: false,
			argv: ({ tipo, params }: { tipo: string; params: Record<string, unknown> }) => [
				"cpe",
				tipo,
				"preview",
				`--params=${JSON.stringify(params)}`,
			],
		},
		{
			name: "rhe_emit_preview",
			title: "Validate or preview an RHE",
			description:
				"Prepare a recibo por honorarios without issuing it. mode 'dry_run' validates the payload locally and never opens SUNAT. mode 'preview' opens SOL, fills the form, reconciles SUNAT's own rendered draft against the payload and stops before Emitir Recibo. Always run dry_run first. Issuing the receipt is not available over MCP: after a clean preview, the user runs `sunat-cli rhe emit --params '...' --yes --live-sunat` in a terminal.",
			inputSchema: {
				mode: z.enum(["dry_run", "preview"]).default("dry_run"),
				params: payload.describe("RHE payload; see sunat_schema 'rhe'"),
			},
			readOnly: true,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: ({ mode, params }: { mode: "dry_run" | "preview"; params: Record<string, unknown> }) => [
				"rhe",
				"emit",
				`--params=${JSON.stringify(params)}`,
				mode === "preview" ? "--preview-only" : "--dry-run",
			],
		},
		{
			name: "f616_periodo",
			title: "Read an F616 period",
			description:
				"Open one F616 monthly period through SUNAT's API and return what the portal reports for it. Read-only. Reuses a cached Nueva Plataforma token and opens the browser only when it has to capture a new one.",
			inputSchema: { periodo: periodoDash.describe("Tax period, YYYY-MM") },
			readOnly: true,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: ({ periodo }: { periodo: string }) => ["f616", "periodo", periodo],
		},
		{
			name: "f616_declare_dry_run",
			title: "Validate an F616 declaration",
			description:
				"Validate an F616 monthly declaration payload locally and report what would be declared. Never contacts SUNAT. Filing the declaration is not available over MCP: the user runs `sunat-cli f616 declare` in a terminal.",
			inputSchema: { params: payload.describe("F616 payload; see sunat_schema 'f616'") },
			readOnly: true,
			openWorld: false,
			argv: ({ params }: { params: Record<string, unknown> }) => [
				"f616",
				"declare",
				`--params=${JSON.stringify(params)}`,
				"--dry-run",
			],
		},
		{
			name: "declaraciones_list",
			title: "List filed declarations",
			description:
				"List the declarations and NPS payments presented to SUNAT in a date range of at most six months, default the last 90 days. Read-only; opens a SOL browser session.",
			inputSchema: {
				desde: sunatDate.optional().describe("Start of the presentation-date range, DD/MM/YYYY"),
				hasta: sunatDate.optional().describe("End of the range, DD/MM/YYYY"),
				formulario: z
					.string()
					.regex(/^\d{3,4}$/, "Expected a form code such as 0621")
					.optional()
					.describe("Keep only this form, e.g. 0601, 0621, 1663"),
				periodo: periodoCompact.optional().describe("Keep only this tax period, YYYYMM"),
			},
			readOnly: true,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: (a: { desde?: string; hasta?: string; formulario?: string; periodo?: string }) => [
				"declaraciones",
				"list",
				...opt("--desde", a.desde),
				...opt("--hasta", a.hasta),
				...opt("--formulario", a.formulario),
				...opt("--periodo", a.periodo),
			],
		},
		{
			name: "buzon_list",
			title: "Read Buzón SOL",
			description:
				"List message and notification metadata from Buzón SOL and save a private local snapshot, so the next call can tell what is new. Metadata only: it never opens a message, because opening one can count as legal notification. Opens a SOL browser session.",
			inputSchema: {
				maxPages: z.number().int().min(1).max(100).optional().describe("Pages to read per inbox, default 25"),
			},
			readOnly: true,
			openWorld: true,
			timeoutMs: BROWSER_TIMEOUT_MS,
			argv: ({ maxPages }: { maxPages?: number }) => ["buzon", "list", ...opt("--max-pages", maxPages)],
		},
		{
			name: "buzon_status",
			title: "Last Buzón snapshot",
			description: "Read the last local Buzón SOL snapshot without contacting SUNAT.",
			inputSchema: {},
			readOnly: true,
			openWorld: false,
			argv: () => ["buzon", "status"],
		},
		{
			name: "renta_declaracion",
			title: "Prefilled annual return",
			description:
				"Return the annual income tax declaration (F709) that SUNAT has prefilled for the taxpayer, with its section totals. Read-only. Needs a renta session: call sunat_login with portal 'renta' first.",
			inputSchema: {
				ejercicio: ejercicio.optional().describe("Tax year, defaults to the one currently being declared"),
				full: z.boolean().optional().describe("Return the whole document instead of the summary"),
			},
			readOnly: true,
			openWorld: true,
			argv: ({ ejercicio, full }: { ejercicio?: string; full?: boolean }) => [
				"renta",
				"declaracion",
				...opt("--ejercicio", ejercicio),
				...(full ? ["--full"] : []),
			],
		},
		{
			name: "renta_presentaciones",
			title: "Filed annual returns",
			description:
				"List the annual income tax declarations already filed for a tax year. Read-only. Needs a renta session: call sunat_login with portal 'renta' first.",
			inputSchema: { ejercicio: ejercicio.optional().describe("Tax year") },
			readOnly: true,
			openWorld: true,
			argv: ({ ejercicio }: { ejercicio?: string }) => ["renta", "presentaciones", ...opt("--ejercicio", ejercicio)],
		},
		{
			name: "audit_list",
			title: "Local audit log",
			description:
				"List recent entries of the local audit log: every dry run, preview and write this CLI performed on this machine, newest first. Use it to confirm what was actually done.",
			inputSchema: {
				ruc: ruc.optional().describe("Keep only entries for this emisor RUC"),
				limit: z.number().int().min(1).max(500).optional().describe("Maximum entries, default 50"),
			},
			readOnly: true,
			openWorld: false,
			argv: ({ ruc, limit }: { ruc?: string; limit?: number }) => [
				"audit",
				"list",
				...opt("--ruc", ruc),
				...opt("--limit", limit),
			],
		},
	];
}

/**
 * The command line for one tool call, after the tool's own schema has
 * validated the arguments.
 *
 * The `LIVE_FLAGS` check cannot fire with the catalogue above: values only
 * ever travel joined to their flag, and positionals are digit-only or enums.
 * It stays because the next tool added here is the one that might get that
 * wrong, and a refused call is the cheap failure.
 */
export function buildArgv(z: typeof Zod, tool: ToolDef, args: unknown): string[] {
	const parsed = z.object(tool.inputSchema).parse(args ?? {});
	const argv = tool.argv(parsed);
	for (const flag of LIVE_FLAGS) {
		if (argv.includes(flag)) {
			throw new Error(`Refusing to run '${tool.name}': ${flag} is not allowed over MCP`);
		}
	}
	return argv;
}
