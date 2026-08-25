export const VERSION = "0.11.2";

export const stats = [
	{ value: "9", label: "Surfaces", detail: "one binary" },
	{ value: "283", label: "Tests", detail: "green against beta" },
	{ value: "0", label: "CAPTCHAs", detail: "one login, then headless" },
];

export const capabilities = [
	{
		title: "Electronic invoices",
		scope: "Factura, boleta, nota de crédito, nota de débito",
		desc: "UBL 2.1 documents, XAdES-BES signatures, SOAP straight to SUNAT. Verified end to end against the beta endpoint.",
		code: '$ sunat-cli cpe factura emit \\\n    --params @factura.json --yes',
	},
	{
		title: "Shipping notices",
		scope: "GRE remitente, modal 02",
		desc: "REST with JWT. The tracker is idempotent, so a retry after a timeout resolves the original submission instead of duplicating it.",
		code: "$ sunat-cli cpe gre emit \\\n    --params @guia.json --yes",
	},
	{
		title: "Sales and purchase ledgers",
		scope: "SIRE RVIE and RCE",
		desc: "Pull the proposal, poll the ticket, download the ZIP, push corrections back through a TUS 1.0.0 upload.",
		code: "$ sunat-cli sire rvie propuesta \\\n    --periodo 202504 --yes",
	},
	{
		title: "Daily summaries and voids",
		scope: "Resumen diario, comunicación de baja",
		desc: "Boletas under S/700 batch into one daily summary. Voids carry the same ticket-polling contract.",
		code: "$ sunat-cli cpe resumen send \\\n    --fecha 2026-04-29 --yes",
	},
	{
		title: "Independent worker filings",
		scope: "RHE and F616",
		desc: "Browser login without a CAPTCHA. Receipts issue in batch; the monthly F616 reads headless from the declaration API behind the form.",
		code: '$ sunat-cli f616 declare \\\n    --json \'{"periodo":"2026-03"}\'',
	},
	{
		title: "Lookups",
		scope: "Padrón RUC, consulta CPE, tipo de cambio",
		desc: "OAuth2 client credentials against the public REST surface. The padrón syncs incrementally so a local lookup answers in under a millisecond.",
		code: "$ sunat-cli api consulta \\\n    --tipo 01 --serie F001 --numero 123",
	},
	{
		title: "Secrets in the OS keychain",
		scope: "Certificate passwords, clave SOL",
		desc: "A hidden prompt writes to the macOS or Linux keychain, which keeps the value out of shell history, environment variables, and the process table.",
		code: "$ sunat-cli keychain set CPE_CERT_PASSWORD",
	},
	{
		title: "Schema introspection",
		scope: "25+ versioned schemas",
		desc: "An agent asks the binary what a command accepts instead of guessing field names. The version is part of the response, so a caller can pin it.",
		code: "$ sunat-cli schema cpe-factura",
	},
];

export const coverage = [
	{
		domain: "REST lookups",
		detail: "Consulta CPE, padrón, tipo de cambio",
		pct: 90,
		state: "shipped" as const,
	},
	{
		domain: "RHE and F616",
		detail: "Personas naturales",
		pct: 95,
		state: "shipped" as const,
	},
	{
		domain: "Invoices",
		detail: "Factura, boleta, NC, ND",
		pct: 85,
		state: "shipped" as const,
	},
	{
		domain: "Daily summary and void",
		detail: "Resumen diario, comunicación de baja",
		pct: 80,
		state: "shipped" as const,
	},
	{
		domain: "SIRE",
		detail: "RVIE ventas and RCE compras",
		pct: 70,
		state: "partial" as const,
	},
	{
		domain: "Shipping notices",
		detail: "Modal 02 only, transportista pending",
		pct: 50,
		state: "partial" as const,
	},
	{
		domain: "Drivers",
		detail: "2 of 5: mock and sunat-direct",
		pct: 40,
		state: "partial" as const,
	},
	{
		domain: "Void with intent token",
		detail: "Shaped, not built",
		pct: 30,
		state: "planned" as const,
	},
	{
		domain: "Production submissions",
		detail: "Never run against live credentials",
		pct: 10,
		state: "untested" as const,
	},
];

export const roadmap = [
	{
		when: "Now",
		items: [{ n: 10, t: "Void with an intent token and its safety rail" }],
	},
	{
		when: "Next",
		items: [
			{ n: 11, t: "Shipping notices modal 01 and transportista" },
			{ n: 12, t: "PSE and OSE drivers: nubefact, apisperu" },
			{ n: 18, t: "Live verification against production" },
		],
	},
	{
		when: "Later",
		items: [
			{ n: 13, t: "Facturador driver, contained Java wrapper" },
			{ n: 14, t: "SIRE complementary reports" },
			{ n: 15, t: "sqlite index for sub-millisecond padrón lookups" },
			{ n: 16, t: "CI smoke jobs with a real browser" },
			{ n: 17, t: "Resume a partial TUS upload" },
		],
	},
	{
		when: "Backlog",
		items: [
			{ n: 19, t: "Cached SUNAT catalogues" },
			{ n: 22, t: "Multi-RUC profile testing" },
		],
	},
];

export const principles = [
	{
		rule: "Payloads, not flag soup",
		why: "A JSON payload survives being written by a model; twenty positional flags do not.",
	},
	{
		rule: "Every mutation previews first",
		why: "--dry-run returns the same shape as the real call, with a hash, so a caller can diff before committing.",
	},
	{
		rule: "JSON when stdout is not a terminal",
		why: "The human view and the machine view come from one code path, so they cannot drift.",
	},
	{
		rule: "Schemas at runtime",
		why: "The binary answers what a command accepts, so an agent never invents a field name.",
	},
	{
		rule: "Input hardening",
		why: "The agent is not a trusted operator. A hallucinated RUC fails validation before it reaches SUNAT.",
	},
	{
		rule: "One skill file per the agentskills.io spec",
		why: "Discovery works the same way for every agent that reads the standard.",
	},
];
