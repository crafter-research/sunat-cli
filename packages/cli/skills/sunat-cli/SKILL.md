---
name: sunat-cli
description: SUNAT tax automation CLI for Peru. Emit Recibos por Honorarios (RHE), file F616 monthly declarations, check auth status, and query SUNAT APIs. Use when: (1) user mentions SUNAT, RHE, recibo por honorarios, F616, impuestos Peru, (2) user wants to emit an invoice, (3) user asks about tax declarations or 4ta categoria, (4) user says "emitir recibo", "declarar F616", "pagar impuestos", "sunat login". Package: @crafter/sunat-cli (npm). Requires Clave SOL credentials in ~/.sunat-cli/.env
---

# sunat-cli

SUNAT tax automation via `npx @crafter/sunat-cli` (or `sunat` if globally installed).

## Prerequisites

Credentials in `~/.sunat-cli/.env` or project `.env`:
```
SUNAT_RUC=10XXXXXXXXX
SUNAT_USER=XXXXXXXX
SUNAT_PASSWORD=XXXXXX
```

## Commands

### Auth

```bash
sunat login                    # SOL viejo (RHE, no captcha)
sunat login --nueva-plataforma # Nueva Plataforma (F616, reCAPTCHA one-time)
sunat whoami                   # Check session status
```

### RHE (Recibo por Honorarios)

```bash
# Emit single RHE
sunat rhe emit --json '{
  "empresa": "Clerk Inc",
  "tipoDoc": "SIN DOCUMENTO",
  "descripcion": "Servicios de desarrollo de software",
  "monto": 6700,
  "moneda": "USD",
  "medioPago": "TRANSFERENCIA"
}'

# Preview without submitting
sunat rhe emit --json '...' --dry-run

# Batch from CSV
sunat rhe emit --batch recibos.csv

# List issued RHEs
sunat rhe list

# Verify registration
sunat rhe verify --month 2026-03
```

**RHE fields**: See `references/schemas.md` for full field specs.

Key rules:
- `tipoDoc`: Use `SIN DOCUMENTO` for foreign companies (no RUC/DNI)
- `moneda`: USD auto-converts to PEN at SUNAT exchange rate
- `fechaEmision`: Max 2-3 days retroactive
- Auth: SOL viejo portal, no captcha

### F616 (Monthly Tax Declaration)

```bash
# Single month
sunat f616 declare --json '{
  "periodo": "2026-03",
  "ingresoPEN": 25000,
  "retenciones": 0
}'

# Preview
sunat f616 declare --json '...' --dry-run

# Batch multiple months
sunat f616 declare --batch --months "2025-03..2026-02"

# Check status
sunat f616 status
```

**F616 computation**: `pagoACuenta = ingresoPEN * 0.08 - retenciones`

Key rules:
- 4ta categoria workers only (freelancers/independent contractors)
- 8% advance payment on monthly income
- Auth: Nueva Plataforma (requires reCAPTCHA v2 one-time)

### API & Schema

```bash
sunat api token              # Get/refresh OAuth2 token
sunat schema rhe             # JSON schema for RHE fields
sunat schema f616            # JSON schema for F616 fields
```

Use `sunat schema <resource>` to get machine-readable field definitions before constructing payloads.

## Output Formats

All commands support `--output <format>`:
- `auto` (default): human-readable
- `json`: machine-readable, pipe to `jq`

## Common Workflows

**Monthly routine (4ta categoria)**:
1. `sunat login --nueva-plataforma`
2. `sunat f616 declare --json '{"periodo":"2026-03","ingresoPEN":25000,"retenciones":0}' --dry-run`
3. Review dry-run output
4. Remove `--dry-run` to submit

**Emit RHE for Clerk**:
1. `sunat login`
2. `sunat rhe emit --json '{"empresa":"Clerk Inc","tipoDoc":"SIN DOCUMENTO","descripcion":"Servicios de desarrollo de software - Marzo 2026","monto":6700,"moneda":"USD","medioPago":"TRANSFERENCIA"}'`
3. `sunat rhe verify --month 2026-03`

## Error Handling

- Session expired: re-run `sunat login`
- reCAPTCHA required: only for Nueva Plataforma, one-time per session
- Network timeout: retry, SUNAT portals are slow
