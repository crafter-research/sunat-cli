---
name: sunat-cli
description: >-
  Automate SUNAT tax operations for Peruvian freelancers: emit Recibos por
  Honorarios Electronicos (RHE), file Formulario 616 monthly declarations,
  and verify via OAuth2 API. Use when the user mentions SUNAT, RHE, taxes,
  impuestos, cuarta categoria, F616, declaraciones, or tax regularization.
license: MIT
compatibility: Requires agent-browser CLI (v0.22+), Bun runtime, and Chrome/Chromium installed. macOS or Linux.
metadata:
  author: railly
  version: "0.1.0"
---

# sunat-cli

Agent-first CLI for SUNAT (Peru's tax authority) automation. Uses agent-browser to control Chrome via CDP.

## Safety rules

- ALWAYS use `--dry-run` before any mutating operation (emit, declare)
- ALWAYS confirm with the user before executing write operations
- NEVER emit RHEs or file declarations without explicit user approval
- Check session status with `sunat whoami --output json` before operations
- Use `sunat schema <resource>` to introspect available fields at runtime

## Prerequisites

1. Environment variables configured in `.env`:
   - `SUNAT_RUC` — RUC number (11 digits)
   - `SUNAT_USER` — SOL username
   - `SUNAT_PASSWORD` — SOL password
   - `SUNAT_API_CLIENT_ID` — OAuth2 client ID (optional, for API verification)
   - `SUNAT_API_CLIENT_SECRET` — OAuth2 client secret (optional)

2. Run from project root: `cd ~/Programming/railly/sunat-cli`

## Step-by-step workflows

### 1. Check auth status

```bash
bun run bin/sunat.ts whoami --output json
```

If sessions are stale or missing, login first.

### 2. Login to SOL (for RHE)

```bash
bun run bin/sunat.ts login
```

No CAPTCHA. Session saved to `~/.sunat/sessions/sol.json`. Expires after ~20 min (auto-refreshes).

### 3. Introspect schemas

```bash
bun run bin/sunat.ts schema rhe     # RHE field definitions
bun run bin/sunat.ts schema f616    # F616 field definitions
bun run bin/sunat.ts schema login   # Auth requirements
```

### 4. Emit single RHE (dry-run first, then real)

```bash
bun run bin/sunat.ts rhe emit --dry-run --json '{"empresa":"Acme Corp.","tipoDoc":"SIN DOCUMENTO","descripcion":"Servicios de desarrollo de software","monto":5000,"moneda":"PEN","medioPago":"TRANSFERENCIA"}'
```

Review the output. If correct:

```bash
bun run bin/sunat.ts rhe emit --json '{"empresa":"Acme Corp.","tipoDoc":"SIN DOCUMENTO","descripcion":"Servicios de desarrollo de software","monto":5000,"moneda":"PEN","medioPago":"TRANSFERENCIA"}'
```

### 5. Batch emit RHEs from CSV

```bash
bun run bin/sunat.ts rhe emit --batch ./data/example.csv --dry-run
bun run bin/sunat.ts rhe emit --batch ./data/example.csv
```

CSV format: `empresa,tipoDoc,descripcion,monto,moneda,medioPago`

### 6. Get OAuth2 API token

```bash
bun run bin/sunat.ts api token --output json
```

Returns a JWT valid for 1 hour. Used for verification calls.

## Input format

Use `--json` for structured input (agent-first design):

```json
{
  "empresa": "Company Name",
  "tipoDoc": "SIN DOCUMENTO",
  "descripcion": "Service description",
  "monto": 5000,
  "moneda": "PEN",
  "medioPago": "TRANSFERENCIA",
  "fechaEmision": "2026-03-25"
}
```

Valid `tipoDoc`: SIN DOCUMENTO, RUC, DNI, PASAPORTE, CARNET DE EXTRANJERIA
Valid `moneda`: PEN, USD
Valid `medioPago`: TRANSFERENCIA, DEPOSITO, EFECTIVO, TARJETA DEBITO, TARJETA CREDITO

## Edge cases

- **Foreign companies**: Use `tipoDoc: "SIN DOCUMENTO"` — no RUC validation needed
- **USD amounts**: Set `moneda: "USD"`, the CLI converts to PEN at SUNAT exchange rate
- **Date restrictions**: SUNAT allows max 2-3 days retroactive for RHE dates
- **F616 auto-populates**: Emit RHEs BEFORE declaring F616 — it pre-fills income data
- **Session expiry**: Sessions last ~20 min. CLI re-authenticates automatically
- **SUNAT blocks headless**: All browser operations use headed Chrome (handled internally)

## Output format

- `--output json`: Machine-readable, NDJSON for arrays (default when piped)
- `--output table`: Human-readable (default when TTY)
- All mutations support `--dry-run` to preview without submitting

## Technical reference

See [RESEARCH.md](references/RESEARCH.md) for detailed portal mapping, CDP techniques, and API documentation.
