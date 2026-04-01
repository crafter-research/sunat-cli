import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const SKILL_DIR = join(process.env.HOME || "", ".claude", "skills", "sunat-cli");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const REFS_DIR = join(SKILL_DIR, "references");
const SCHEMAS_MD = join(REFS_DIR, "schemas.md");

export function isSkillInstalled(): boolean {
	return existsSync(SKILL_MD);
}

export function installSkill(): void {
	mkdirSync(REFS_DIR, { recursive: true });
	writeFileSync(SKILL_MD, SKILL_CONTENT);
	writeFileSync(SCHEMAS_MD, SCHEMAS_CONTENT);
}

export function getSkillVersion(): string | null {
	if (!existsSync(SKILL_MD)) return null;
	const content = readFileSync(SKILL_MD, "utf-8");
	const match = content.match(/version:\s*"?([^"\n]+)"?/);
	return match ? match[1].trim() : null;
}

const CURRENT_VERSION = "0.1.3";

export function needsUpdate(): boolean {
	const installed = getSkillVersion();
	return installed !== CURRENT_VERSION;
}

const SKILL_CONTENT = `---
name: sunat-cli
version: "${CURRENT_VERSION}"
description: |
  SUNAT tax automation CLI for Peru. Emit Recibos por Honorarios (RHE),
  file F616 monthly declarations, check auth status, and query SUNAT APIs.
  Use when: (1) user mentions SUNAT, RHE, recibo por honorarios, F616,
  impuestos Peru, (2) user wants to emit an invoice, (3) user asks about
  tax declarations or 4ta categoria, (4) user says "emitir recibo",
  "declarar F616", "pagar impuestos", "sunat login".
  Package: @crafter/sunat-cli (npm).
---

# sunat-cli

SUNAT tax automation via \`npx @crafter/sunat-cli\`.

## Prerequisites

Credentials via env vars or \`~/.sunat/config.json\`:
\`\`\`bash
export SUNAT_RUC=10XXXXXXXXX
export SUNAT_USER=XXXXXXXX
export SUNAT_PASSWORD=XXXXXX
\`\`\`

Or run \`sunat login\` to authenticate interactively.

## Commands

### Auth

\`\`\`bash
sunat login                    # SOL viejo (RHE, no captcha)
sunat login --nueva-plataforma # Nueva Plataforma (F616, reCAPTCHA one-time)
sunat whoami                   # Check session status
\`\`\`

### RHE (Recibo por Honorarios)

\`\`\`bash
sunat rhe emit --json '{
  "empresa": "Clerk Inc",
  "tipoDoc": "SIN DOCUMENTO",
  "descripcion": "Servicios de desarrollo de software",
  "monto": 6700,
  "moneda": "USD",
  "medioPago": "TRANSFERENCIA"
}'

sunat rhe emit --json '...' --dry-run   # Preview
sunat rhe emit --batch recibos.csv      # Batch from CSV
sunat rhe list                          # List issued
sunat rhe verify --month 2026-03        # Verify registration
\`\`\`

Key rules:
- \`tipoDoc\`: Use \`SIN DOCUMENTO\` for foreign companies
- \`moneda\`: USD auto-converts to PEN at SUNAT exchange rate
- Auth: SOL viejo portal, no captcha

### F616 (Monthly Tax Declaration)

\`\`\`bash
sunat f616 declare --json '{
  "periodo": "2026-03",
  "ingresoPEN": 25000,
  "retenciones": 0
}'

sunat f616 declare --json '...' --dry-run          # Preview
sunat f616 declare --batch --months "2025-03..2026-02"  # Batch
sunat f616 status                                   # Check status
\`\`\`

Computation: \`pagoACuenta = ingresoPEN * 0.08 - retenciones\`
Auth: Nueva Plataforma (requires reCAPTCHA v2 one-time)

### Introspection

\`\`\`bash
sunat schema rhe    # JSON schema for RHE fields
sunat schema f616   # JSON schema for F616 fields
sunat api token     # Get/refresh OAuth2 token
\`\`\`

Use \`sunat schema <resource>\` before constructing payloads.

## Output

All commands support \`--output json\` for machine-readable output.

## Field Reference

See [references/schemas.md](references/schemas.md) for full field specs and typical payloads.
`;

const SCHEMAS_CONTENT = `# SUNAT CLI Schemas

## RHE Emit Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| empresa | string(100) | yes | - | Company/person receiving service |
| tipoDoc | enum | no | SIN DOCUMENTO | SIN DOCUMENTO, RUC, DNI, CARNET DE EXTRANJERIA, PASAPORTE |
| descripcion | string(200) | yes | - | Service description |
| monto | number | yes | - | Amount (0.01-1000000). USD auto-converts |
| moneda | enum | no | PEN | PEN or USD |
| medioPago | enum | no | TRANSFERENCIA | DEPOSITO, GIRO, TRANSFERENCIA, ORDEN DE PAGO, TARJETA DEBITO/CREDITO, CHEQUE, EFECTIVO |
| fechaEmision | date | no | today | YYYY-MM-DD. Max 2-3 days retroactive |

## F616 Declare Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| periodo | string | yes | - | YYYY-MM tax period |
| ingresoPEN | number | yes | - | Total monthly income in PEN |
| retenciones | number | no | 0 | 4ta categoria withholdings |

Computed: \`pagoACuenta = ingresoPEN * 0.08 - retenciones\`

## CSV Batch Format (RHE)

\`\`\`csv
empresa,tipoDoc,descripcion,monto,moneda,medioPago,fechaEmision
"Clerk Inc","SIN DOCUMENTO","Desarrollo software",6700,USD,TRANSFERENCIA,2026-01-31
\`\`\`
`;
