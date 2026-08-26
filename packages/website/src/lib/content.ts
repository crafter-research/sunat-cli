import type { Locale } from "./i18n";

export const VERSION = "0.15.0";

/**
 * Copy lives per locale rather than as a key/value dictionary with one canonical
 * source. Spanish is written for a Peruvian taxpayer or their contador and uses
 * the vocabulary SUNAT itself uses; English is written for someone reading the
 * repo who has never filed here and needs the domain explained. Neither reads
 * like a translation of the other, which is the point.
 */

type Stat = { value: string; label: string; detail: string };
type Capability = {
	title: string;
	scope: string;
	desc: string;
	code: string;
};
type CoverageRow = {
	domain: string;
	detail: string;
	pct: number;
	state: "shipped" | "partial" | "planned" | "untested";
};
type RoadmapCol = { when: string; items: { n: number; t: string }[] };
type Principle = { rule: string; why: string };

export type Content = {
	meta: { title: string; description: string };
	nav: {
		capabilities: string;
		architecture: string;
		coverage: string;
		roadmap: string;
		principles: string;
	};
	a11y: {
		skip: string;
		sections: string;
		theme: string;
		language: string;
		home: string;
	};
	theme: { light: string; system: string; dark: string };
	hero: { lede: string; cta: string };
	stats: Stat[];
	capabilities: {
		heading: string;
		count: (n: number) => string;
		items: Capability[];
	};
	architecture: {
		heading: string;
		prose: string[];
		steps: { n: string; title: string; desc: string }[];
	};
	coverage: {
		heading: string;
		shipped: (n: number, total: number) => string;
		note: string;
		th: { surface: string; wrapped: string; pct: string; state: string };
		caption: string;
		states: Record<CoverageRow["state"], string>;
		rows: CoverageRow[];
	};
	roadmap: { heading: string; note: string; cols: RoadmapCol[] };
	principles: { heading: string; lede: string; items: Principle[] };
	footer: { org: string; tagline: string; legal: string; source: string };
	legal: { back: string };
};

const es: Content = {
	meta: {
		title: "sunat-cli — automatiza SUNAT desde la terminal",
		description:
			"CLI que envuelve diez superficies de SUNAT: comprobantes electrónicos, SIRE, guías de remisión, Buzón SOL, recibos por honorarios y F616, y las APIs REST. Pensada para que un agente la opere sin romper nada.",
	},
	nav: {
		capabilities: "Qué cubre",
		architecture: "Arquitectura",
		coverage: "Cobertura",
		roadmap: "Roadmap",
		principles: "Diseño",
	},
	a11y: {
		skip: "Saltar al contenido",
		sections: "Secciones",
		theme: "Tema de color",
		language: "Idioma",
		home: "sunat-cli, ir al inicio",
	},
	theme: { light: "Claro", system: "Sistema", dark: "Oscuro" },
	hero: {
		lede: "SUNAT expone diez superficies distintas: SOAP con XML firmado, REST con OAuth, una cola de tickets, una carga reanudable, un buzón legacy, una API JSON y una sesión de formularios HTTP. Esto las envuelve en un binario que un agente puede manejar bajo supervisión.",
		cta: "Ver qué cubre",
	},
	stats: [
		{ value: "10", label: "Superficies", detail: "un solo binario" },
		{ value: "500+", label: "Tests", detail: "en verde" },
		{ value: "2", label: "Modos", detail: "headless y supervisado" },
	],
	capabilities: {
		heading: "Qué cubre",
		count: (n) => `${n} superficies`,
		items: [
			{
				title: "Comprobantes electrónicos",
				scope: "Factura, boleta, nota de crédito, nota de débito",
				desc: "Documentos UBL 2.1, firma XAdES-BES y SOAP directo a SUNAT. Verificado de punta a punta contra el endpoint beta.",
				code: "$ sunat-cli cpe factura emit \\\n    --params @factura.json --yes",
			},
			{
				title: "Guías de remisión",
				scope: "GRE remitente, modal 02",
				desc: "REST con JWT. El tracker es idempotente, así que reintentar después de un timeout resuelve el envío original en vez de duplicarlo.",
				code: "$ sunat-cli cpe gre emit \\\n    --params @guia.json --yes",
			},
			{
				title: "Registro de ventas y compras",
				scope: "SIRE RVIE y RCE",
				desc: "Baja la propuesta, hace polling del ticket, descarga el ZIP y sube las correcciones por TUS 1.0.0.",
				code: "$ sunat-cli sire rvie propuesta \\\n    --periodo 202504 --yes",
			},
			{
				title: "Resumen diario y bajas",
				scope: "Resumen diario, comunicación de baja",
				desc: "Las boletas de menos de S/700 se agrupan en un resumen diario. Las bajas siguen el mismo contrato de ticket.",
				code: "$ sunat-cli cpe resumen send \\\n    --fecha 2026-04-29 --yes",
			},
			{
				title: "Rentas de cuarta",
				scope: "RHE y F616",
				desc: "En RHE, el navegador obtiene la entrada SOL, HTTP llega al borrador, la confirmación legal queda supervisada y la descarga XML/PDF está conectada para validarla en la próxima emisión real. F616 conserva su lectura headless por API.",
				code: '$ sunat-cli rhe emit \\\n    --params \'{"empresa":"Cliente","descripcion":"Servicio","monto":100}\' --preview-only',
			},
			{
				title: "Consultas",
				scope: "Padrón RUC, consulta CPE, tipo de cambio",
				desc: "OAuth2 client credentials contra la superficie REST pública. El padrón sincroniza incremental, así que una consulta local responde en menos de un milisegundo.",
				code: "$ sunat-cli api consulta \\\n    --tipo 01 --serie F001 --numero 123",
			},
			{
				title: "Buzón SOL",
				scope: "Mensajes y notificaciones, solo metadata",
				desc: "Lista sin abrir el detalle, conserva conteos contradictorios como evidencia y detecta novedades con un snapshot privado local.",
				code: "$ sunat-cli buzon list",
			},
			{
				title: "Secretos en el llavero del sistema",
				scope: "Contraseña del certificado, clave SOL",
				desc: "El prompt oculto escribe en el llavero de macOS o Linux, así el valor no queda en el historial del shell, ni en variables de entorno, ni en la tabla de procesos.",
				code: "$ sunat-cli keychain set CPE_CERT_PASSWORD",
			},
			{
				title: "Introspección de esquemas",
				scope: "Más de 25 esquemas versionados",
				desc: "El agente le pregunta al binario qué acepta un comando en vez de adivinar los nombres de los campos. La versión viene en la respuesta, así que se puede fijar.",
				code: "$ sunat-cli schema cpe-factura",
			},
		],
	},
	architecture: {
		heading: "Endpoints primero, navegador en el borde",
		prose: [
			"La página del F616 parece un formulario. Es una aplicación de una sola página hablando con una API JSON, y los campos del formulario son la forma menos confiable de llegar ahí.",
			"RHE es distinto: Menu SOL genera una entrada efímera y el backend responde HTML. La CLI usa HTTP para deducción, identidad y detalles, vuelve a renderizar el borrador, reserva el DOM para la confirmación legal y conecta XML/PDF por endpoint después de emitir.",
		],
		steps: [
			{
				n: "01",
				title: "Bootstrap",
				desc: "Abre SOL y obtiene la entrada o token que la superficie oficial exige.",
			},
			{
				n: "02",
				title: "HTTP directo",
				desc: "Llama la API o sesión de formularios y valida la respuesta real del servidor.",
			},
			{
				n: "03",
				title: "Confirmar",
				desc: "Para RHE, mantiene la acción legal bajo control humano y después valida y guarda los archivos si SUNAT responde con XML/PDF reales.",
			},
		],
	},
	coverage: {
		heading: "Hasta dónde llega cada superficie",
		shipped: (n, total) => `${n} de ${total} en producción y verificadas`,
		note: "Los porcentajes son un juicio sobre cuánto de cada superficie está envuelto y disponible para un agente. El lector de metadata del Buzón SOL fue verificado con una cuenta propia en producción. Los envíos tributarios siguen en beta.",
		th: {
			surface: "Superficie",
			wrapped: "Cubierto",
			pct: "%",
			state: "Estado",
		},
		caption: "Cobertura por superficie de SUNAT, con avance y estado",
		states: {
			shipped: "listo",
			partial: "parcial",
			planned: "planeado",
			untested: "sin probar",
		},
		rows: [
			{
				domain: "Consultas REST",
				detail: "Consulta CPE, padrón, tipo de cambio",
				pct: 90,
				state: "shipped",
			},
			{
				domain: "RHE y F616",
				detail: "RHE supervisado; XML/PDF conectado, falta live",
				pct: 85,
				state: "partial",
			},
			{
				domain: "Buzón SOL",
				detail: "Metadata, snapshot y novedades",
				pct: 45,
				state: "partial",
			},
			{
				domain: "Comprobantes",
				detail: "Factura, boleta, NC, ND",
				pct: 85,
				state: "shipped",
			},
			{
				domain: "Resumen diario y baja",
				detail: "Resumen diario, comunicación de baja",
				pct: 80,
				state: "shipped",
			},
			{
				domain: "SIRE",
				detail: "RVIE ventas y RCE compras",
				pct: 70,
				state: "partial",
			},
			{
				domain: "Guías de remisión",
				detail: "Solo modal 02, falta transportista",
				pct: 50,
				state: "partial",
			},
			{
				domain: "Drivers",
				detail: "2 de 5: mock y sunat-direct",
				pct: 40,
				state: "partial",
			},
			{
				domain: "Baja con intent token",
				detail: "Diseñado, no construido",
				pct: 30,
				state: "planned",
			},
			{
				domain: "Envíos a producción",
				detail: "Nunca ejecutado con credenciales reales",
				pct: 10,
				state: "untested",
			},
		],
	},
	roadmap: {
		heading: "Qué viene",
		note: "Los números enlazan al tracker",
		cols: [
			{
				when: "Ahora",
				items: [
					{ n: 10, t: "Baja con intent token y su barrera de seguridad" },
				],
			},
			{
				when: "Después",
				items: [
					{ n: 11, t: "Guías modal 01 y transportista" },
					{ n: 12, t: "Drivers PSE y OSE: nubefact, apisperu" },
					{ n: 18, t: "Verificación en vivo contra producción" },
				],
			},
			{
				when: "Más adelante",
				items: [
					{ n: 13, t: "Driver facturador, wrapper de Java contenido" },
					{ n: 14, t: "Reportes complementarios de SIRE" },
					{
						n: 15,
						t: "Índice sqlite para consultas de padrón sub-milisegundo",
					},
					{ n: 16, t: "Jobs de humo en CI con navegador real" },
					{ n: 17, t: "Reanudar una carga TUS parcial" },
				],
			},
			{
				when: "Backlog",
				items: [
					{ n: 19, t: "Catálogos de SUNAT cacheados" },
					{ n: 22, t: "Pruebas con múltiples RUC" },
				],
			},
		],
	},
	principles: {
		heading: "Pensada para quien la llama y no es de fiar",
		lede: "Un agente va a equivocarse en el nombre de un campo, reintentar una llamada que ya salió bien, y seguir de largo después de un error donde debía frenar. Cada regla de acá existe porque una de esas fallas es barata de prevenir y cara de deshacer cuando del otro lado está SUNAT.",
		items: [
			{
				rule: "Payloads, no sopa de flags",
				why: "Un payload JSON sobrevive a que lo escriba un modelo; veinte flags posicionales no.",
			},
			{
				rule: "Toda mutación se previsualiza",
				why: "En RHE, --dry-run valida localmente y --preview-only reconcilia el borrador real de SUNAT antes de habilitar la emisión.",
			},
			{
				rule: "JSON cuando stdout no es una terminal",
				why: "La vista humana y la vista de máquina salen del mismo código, así que no pueden divergir.",
			},
			{
				rule: "Esquemas en tiempo de ejecución",
				why: "El binario responde qué acepta un comando, así el agente nunca inventa un nombre de campo.",
			},
			{
				rule: "Validación de entrada",
				why: "El agente no es un operador de confianza. Un RUC alucinado falla la validación antes de llegar a SUNAT.",
			},
			{
				rule: "Un archivo de skill según agentskills.io",
				why: "El descubrimiento funciona igual para cualquier agente que lea el estándar.",
			},
		],
	},
	footer: {
		org: "Crafter Station",
		tagline: "investigación gov-tech",
		legal: "Legal",
		source: "Código",
	},
	legal: { back: "Volver" },
};

const en: Content = {
	meta: {
		title: "sunat-cli — agent-first tax automation for Peru",
		description:
			"A command-line tool that wraps ten SUNAT surfaces: electronic invoices, ledgers, shipping notices, Buzón SOL, independent worker filings, and REST lookups. Built so an AI agent can operate it safely.",
	},
	nav: {
		capabilities: "Capabilities",
		architecture: "Architecture",
		coverage: "Coverage",
		roadmap: "Roadmap",
		principles: "Agent DX",
	},
	a11y: {
		skip: "Skip to content",
		sections: "Sections",
		theme: "Colour theme",
		language: "Language",
		home: "sunat-cli home",
	},
	theme: { light: "Light", system: "System", dark: "Dark" },
	hero: {
		lede: "Peru's tax authority exposes ten different surfaces: SOAP with signed XML, REST with OAuth, a ticket queue, a resumable upload, a legacy inbox, a JSON API, and a stateful HTTP form session. This wraps them in one supervised agent-facing binary.",
		cta: "See what it covers",
	},
	stats: [
		{ value: "10", label: "Surfaces", detail: "one binary" },
		{ value: "500+", label: "Tests", detail: "green" },
		{ value: "2", label: "Modes", detail: "headless and supervised" },
	],
	capabilities: {
		heading: "What it covers",
		count: (n) => `${n} surfaces`,
		items: [
			{
				title: "Electronic invoices",
				scope: "Factura, boleta, nota de crédito, nota de débito",
				desc: "UBL 2.1 documents, XAdES-BES signatures, SOAP straight to SUNAT. Verified end to end against the beta endpoint.",
				code: "$ sunat-cli cpe factura emit \\\n    --params @factura.json --yes",
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
				desc: "For RHE, the browser obtains the SOL entry, HTTP reaches the draft, the legal confirmation stays supervised, and XML/PDF download is wired for validation on the next real issuance. F616 keeps its headless API read path.",
				code: '$ sunat-cli rhe emit \\\n    --params \'{"empresa":"Client","descripcion":"Service","monto":100}\' --preview-only',
			},
			{
				title: "Lookups",
				scope: "Padrón RUC, consulta CPE, tipo de cambio",
				desc: "OAuth2 client credentials against the public REST surface. The padrón syncs incrementally so a local lookup answers in under a millisecond.",
				code: "$ sunat-cli api consulta \\\n    --tipo 01 --serie F001 --numero 123",
			},
			{
				title: "Buzón SOL",
				scope: "Messages and notifications, metadata only",
				desc: "Lists without opening detail, preserves contradictory counts as evidence, and detects changes with a private local snapshot.",
				code: "$ sunat-cli buzon list",
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
		],
	},
	architecture: {
		heading: "Endpoints first, browser at the boundary",
		prose: [
			"The F616 declaration page looks like a form. It is a single-page app talking to a JSON API, and the form fields are the least reliable way to reach it.",
			"RHE is different: Menu SOL mints an ephemeral entry and the backend returns HTML. The CLI uses HTTP for deduction, identity, and details, renders the draft again, reserves DOM automation for the legal confirmation, and wires XML/PDF through endpoints after issuance.",
		],
		steps: [
			{
				n: "01",
				title: "Bootstrap",
				desc: "Open SOL and obtain the entry or token required by the official surface.",
			},
			{
				n: "02",
				title: "Direct HTTP",
				desc: "Call the API or form session and validate the server's real response.",
			},
			{
				n: "03",
				title: "Confirm",
				desc: "For RHE, keep the legal action under human control, then validate and save artifacts only when SUNAT returns real XML/PDF bytes.",
			},
		],
	},
	coverage: {
		heading: "How far each surface goes",
		shipped: (n, total) => `${n} of ${total} shipped and verified`,
		note: "Percentages are a judgement about how much of each surface is wrapped and callable by an agent. The Buzón SOL metadata reader was verified with an own production account. Tax submissions remain beta.",
		th: { surface: "Surface", wrapped: "Wrapped", pct: "%", state: "State" },
		caption: "Coverage by SUNAT surface, with completeness and state",
		states: {
			shipped: "shipped",
			partial: "partial",
			planned: "planned",
			untested: "untested",
		},
		rows: [
			{
				domain: "REST lookups",
				detail: "Consulta CPE, padrón, tipo de cambio",
				pct: 90,
				state: "shipped",
			},
			{
				domain: "RHE and F616",
				detail: "Supervised RHE; XML/PDF wired, live pending",
				pct: 85,
				state: "partial",
			},
			{
				domain: "Buzón SOL",
				detail: "Metadata, snapshot and changes",
				pct: 45,
				state: "partial",
			},
			{
				domain: "Invoices",
				detail: "Factura, boleta, NC, ND",
				pct: 85,
				state: "shipped",
			},
			{
				domain: "Daily summary and void",
				detail: "Resumen diario, comunicación de baja",
				pct: 80,
				state: "shipped",
			},
			{
				domain: "SIRE",
				detail: "RVIE ventas and RCE compras",
				pct: 70,
				state: "partial",
			},
			{
				domain: "Shipping notices",
				detail: "Modal 02 only, transportista pending",
				pct: 50,
				state: "partial",
			},
			{
				domain: "Drivers",
				detail: "2 of 5: mock and sunat-direct",
				pct: 40,
				state: "partial",
			},
			{
				domain: "Void with intent token",
				detail: "Shaped, not built",
				pct: 30,
				state: "planned",
			},
			{
				domain: "Production submissions",
				detail: "Never run against live credentials",
				pct: 10,
				state: "untested",
			},
		],
	},
	roadmap: {
		heading: "What is next",
		note: "Issue numbers link to the tracker",
		cols: [
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
		],
	},
	principles: {
		heading: "Built for a caller that is not trusted",
		lede: "An agent will get a field name wrong, retry a call that already succeeded, and read past an error it should have stopped on. Each rule below exists because one of those failures is cheap to prevent and expensive to undo when the other end is a tax authority.",
		items: [
			{
				rule: "Payloads, not flag soup",
				why: "A JSON payload survives being written by a model; twenty positional flags do not.",
			},
			{
				rule: "Every mutation previews first",
				why: "For RHE, --dry-run validates locally and --preview-only reconciles SUNAT's real draft before issuance is enabled.",
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
		],
	},
	footer: {
		org: "Crafter Station",
		tagline: "gov-tech research",
		legal: "Legal",
		source: "Source",
	},
	legal: { back: "Back" },
};

const CONTENT: Record<Locale, Content> = { es, en };

export function useContent(locale: Locale): Content {
	return CONTENT[locale];
}

/**
 * The legal page. Kept apart from the marketing copy above because its wording
 * is load-bearing: it names Peruvian statutes and states what the tool does and
 * does not do with someone's tax credentials. The Spanish is the version that
 * matters, since those laws apply in Spanish.
 */

export type LegalContent = {
	title: string;
	updated: string;
	sections: {
		heading: string;
		paras?: string[];
		list?: string[];
		refs?: string[];
	}[];
	contact: { heading: string; lead: string; email: string; org: string };
};

const legalEs: LegalContent = {
	title: "Marco legal",
	updated: "Última actualización: 26 de agosto de 2026",
	sections: [
		{
			heading: "Sobre esta herramienta",
			paras: [
				"sunat-cli es una herramienta de automatización de código abierto que interactúa con los portales web de SUNAT (Superintendencia Nacional de Aduanas y de Administración Tributaria) en nombre de usuarios autenticados. No extrae, recopila ni almacena datos de terceros.",
			],
		},
		{
			heading: "Responsabilidad del usuario",
			paras: [
				"Esta herramienta automatiza el envío de formularios usando SUS credenciales (clave SOL). Usted es el único responsable de:",
			],
			list: [
				"La exactitud de las declaraciones tributarias enviadas con esta herramienta",
				"El cumplimiento de los plazos y obligaciones tributarias ante SUNAT",
				"El resguardo de su clave SOL",
				"Revisar toda operación con --dry-run y, para RHE, con --preview-only antes de emitir",
			],
		},
		{
			heading: "Base legal de la automatización",
			paras: [
				"La legislación peruana no prohíbe la interacción automatizada con portales web del Estado cuando la realiza el titular autenticado de la cuenta para sus propias obligaciones tributarias.",
			],
			refs: [
				"Ley 27269, Ley de Firmas y Certificados Digitales: los envíos electrónicos tienen la misma validez legal que los presentados de forma manual.",
				"Decreto Legislativo 1310, simplificación administrativa: el Estado promoverá el uso de tecnología para simplificar los procedimientos administrativos.",
			],
		},
		{
			heading: "Protección de datos",
			paras: [
				"sunat-cli funciona íntegramente en su máquina local. No se envían datos a servidores de terceros. Las llamadas a la API van exclusivamente a endpoints oficiales de SUNAT (*.sunat.gob.pe).",
			],
			list: [
				"Los secretos se guardan en el llavero del sistema operativo; la configuración de cuenta que no es secreta vive en ~/.sunat/",
				"Los registros de auditoría se guardan localmente, minimizados y con permisos solo para el dueño",
				"Ciertos tokens de sesión de corta vida se cachean localmente con permisos solo para el dueño",
				"No hay analítica ni telemetría; las operaciones tributarias solo se transmiten a endpoints oficiales de SUNAT",
			],
			refs: [
				"Ley 29733, Ley de Protección de Datos Personales: todo el tratamiento de datos personales ocurre localmente y bajo control del usuario.",
			],
		},
		{
			heading: "Términos de servicio de SUNAT",
			paras: [
				"El portal de Operaciones en Línea de SUNAT no prohíbe explícitamente el acceso automatizado por parte de usuarios autenticados. Sin embargo:",
			],
			list: [
				"Esta herramienta usa Chrome visible cuando SUNAT exige autenticación o confirmación interactiva y HTTP directo para los tramos verificados",
				"Las operaciones incluyen demoras realistas entre envíos de formularios",
				"No se intenta eludir ningún límite de tasa",
				"La herramienta respeta el vencimiento de sesión y se reautentica correctamente",
			],
		},
		{
			heading: "Descargo de responsabilidad",
			paras: [
				'sunat-cli se entrega "tal cual", sin garantía. Los autores no se responsabilizan por multas tributarias, declaraciones incorrectas ni pérdidas económicas derivadas del uso de esta herramienta. Verifique siempre sus declaraciones con un contador.',
				"Esta herramienta no está afiliada, avalada ni conectada oficialmente con SUNAT de ninguna forma. SUNAT es una marca del Estado peruano.",
			],
		},
		{
			heading: "Licencia de código abierto",
			paras: [
				"sunat-cli se publica bajo la licencia MIT. Código fuente: github.com/crafter-research/sunat-cli",
			],
		},
	],
	contact: {
		heading: "Contacto",
		lead: "Para consultas legales:",
		email: "legal@crafterstation.com",
		org: "Crafter Station, Lima, Perú",
	},
};

const legalEn: LegalContent = {
	title: "Legal framework",
	updated: "Last updated: August 26, 2026",
	sections: [
		{
			heading: "About this tool",
			paras: [
				"sunat-cli is an open-source automation tool that interacts with SUNAT (Superintendencia Nacional de Aduanas y de Administracion Tributaria) web portals on behalf of authenticated users. It does not scrape, collect, or store third-party data.",
			],
		},
		{
			heading: "User responsibility",
			paras: [
				"This tool automates form submissions using YOUR credentials (Clave SOL). You are solely responsible for:",
			],
			list: [
				"The accuracy of tax declarations submitted through this tool",
				"Compliance with SUNAT deadlines and tax obligations",
				"Safeguarding your Clave SOL credentials",
				"Reviewing every operation via --dry-run and RHE issuance via --preview-only before submitting",
			],
		},
		{
			heading: "Legal basis for automation",
			paras: [
				"Peruvian law does not prohibit automated interaction with government web portals when performed by the authenticated account holder for their own tax obligations.",
			],
			refs: [
				"Ley 27269, Ley de Firmas y Certificados Digitales: Electronic submissions have the same legal validity as manual submissions.",
				"Decreto Legislativo 1310, simplificacion administrativa: The State shall promote the use of technology to simplify administrative procedures.",
			],
		},
		{
			heading: "Data protection",
			paras: [
				"sunat-cli operates entirely on your local machine. No data is sent to third-party servers. API calls go exclusively to official SUNAT endpoints (*.sunat.gob.pe).",
			],
			list: [
				"Secrets stored in the OS keychain, with non-secret account configuration under ~/.sunat/",
				"Minimized audit logs stored locally with owner-only permissions",
				"Selected short-lived API session tokens cached locally with owner-only permissions",
				"No analytics or telemetry; tax operations transmit only to official SUNAT endpoints",
			],
			refs: [
				"Ley 29733, Ley de Proteccion de Datos Personales: All personal data processing occurs locally under the user's control.",
			],
		},
		{
			heading: "SUNAT terms of service",
			paras: [
				"SUNAT's Operaciones en Linea portal does not explicitly prohibit automated access by authenticated users. However:",
			],
			list: [
				"This tool uses headed Chrome when SUNAT requires interactive authentication or confirmation, and direct HTTP for verified intermediate stages",
				"Operations include realistic delays between form submissions",
				"No rate-limiting circumvention is attempted",
				"The tool respects session timeouts and re-authenticates properly",
			],
		},
		{
			heading: "Disclaimer",
			paras: [
				'sunat-cli is provided "as is" without warranty. The authors are not responsible for any tax penalties, incorrect declarations, or financial losses resulting from the use of this tool. Always verify declarations with a qualified tax professional (contador).',
				"This tool is not affiliated with, endorsed by, or officially connected to SUNAT in any way. SUNAT is a trademark of the Peruvian government.",
			],
		},
		{
			heading: "Open source license",
			paras: [
				"sunat-cli is released under the MIT License. Source code: github.com/crafter-research/sunat-cli",
			],
		},
	],
	contact: {
		heading: "Contact",
		lead: "For legal inquiries:",
		email: "legal@crafterstation.com",
		org: "Crafter Station, Lima, Peru",
	},
};

const LEGAL: Record<Locale, LegalContent> = { es: legalEs, en: legalEn };

export function useLegal(locale: Locale): LegalContent {
	return LEGAL[locale];
}
