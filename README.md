<p align="center">
  <a href="https://sunat-cli.crafter.ing" target="_blank">
    <img src="https://raw.githubusercontent.com/Railly/crafter-station/main/public/logo.png" height="64" alt="Crafter Station">
  </a>
  <br />
  <h1 align="center">sunat-cli</h1>
</p>

<p align="center">
  Agent-first CLI for SUNAT tax automation in Peru. Built for AI agents as primary consumers, humans as supervisors.
</p>

<div align="center">

[![npm](https://img.shields.io/npm/v/@crafter/sunat-cli?label=npm)](https://www.npmjs.com/package/@crafter/sunat-cli)
[![Release](https://img.shields.io/github/v/release/crafter-research/sunat-cli?display_name=tag&sort=semver&label=release)](https://github.com/crafter-research/sunat-cli/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Built with Crafter Station](https://img.shields.io/badge/built%20with-Crafter%20Station-orange)](https://crafterstation.com)
[![sunat-cli.crafter.ing](https://img.shields.io/badge/site-sunat--cli.crafter.ing-black)](https://sunat-cli.crafter.ing)

</div>

## What it does

| Domain | Coverage | Surface |
|--------|----------|---------|
| **REST APIs** (Consulta CPE, Padrón RUC, Tipo Cambio SBS) | 90% | OAuth2 client_credentials + scrape (`cpe consulta`, `padron`, `tipo-cambio`) |
| **RHE + F616** (personas naturales, RUC 10) | 95% | agent-browser, no CAPTCHA |
| **CPE Factura / Boleta / NC / ND** | 85% | UBL 2.1 + XAdES-BES + SOAP directo |
| **Resumen Diario + Comunicación de Baja** | 80% | sendSummary + ticket polling |
| **SIRE** (RVIE Ventas + RCE Compras) | 70% | propuesta, ticket, descarga ZIP, TUS 1.0.0 import |
| **GRE Remitente / Transportista** | 50% | REST + JWT, modal 02 shipped |
| **Drivers** (mock, sunat-direct, facturador, PSE/OSE) | 40% | 2 of 5 — facturador / nubefact / apisperu shaped |
| **CPE void T3** | 30% | shaped, intent-token flow pending |
| **Producción end-to-end** | 10% | beta-only — never run prod blind |

**Overall: ~61% agent-ready** across 9 SUNAT surfaces. Live coverage breakdown + roadmap on [the website](https://sunat-cli.crafter.ing#coverage).

## Requirements

- [Bun](https://bun.sh) v1.2+
- [agent-browser](https://github.com/vercel-labs/agent-browser) v0.22+ (only for RHE / F616)
- Chrome or Chromium (CDP transport for agent-browser)
- For CPE / SIRE / GRE: a SUNAT digital certificate (PFX) + clave SOL

## Install

```bash
bun add -g @crafter/sunat-cli
```

Run `sunat-cli --help` after installing. That list is the contract: every command
it prints is available in the version you have.

## Usage

Every section below is tagged `npm`, meaning it ships in the published release.
A section tagged `source` would exist on `main` only. Right now nothing is
source-only: the published release matches `main`.

### CPE — Comprobantes Electrónicos (empresas, RUC 20) · `npm`

```bash
# Health check + driver info
sunat-cli cpe doctor --output json
sunat-cli cpe info

# Schema introspection (agents self-serve)
sunat-cli schema cpe-factura

# Always preview (T0 — no side effects)
sunat-cli cpe factura preview --params @factura.json

# Emit (T2 — requires --yes)
sunat-cli cpe factura emit --params @factura.json --yes

# Boleta / NC / ND — same shape
sunat-cli cpe boleta emit --params @boleta.json --yes
sunat-cli cpe nc emit --params @nota.json --yes
sunat-cli cpe nd emit --params @nota.json --yes

# Resumen diario (boletas <S/700)
sunat-cli cpe resumen send --fecha 2026-04-29 --yes
sunat-cli cpe resumen status --ticket 12345...

# Comunicación de Baja
sunat-cli cpe baja send --params @baja.json --yes

# GRE — Guía de Remisión Remitente (modal 02)
sunat-cli cpe gre emit --params @guia.json --yes
sunat-cli cpe gre status --ticket 12345...

# Consulta CPE (validación post-emisión, propia o de un proveedor)
sunat-cli cpe consulta --tipo 01 --serie F001 --numero 1234
```

### SIRE — Sistema Integrado de Registros Electrónicos · `npm`

```bash
# RVIE (Ventas)
sunat-cli sire ventas periodos
sunat-cli sire ventas propuesta --periodo 202504
sunat-cli sire ventas ticket --id <ticket-id>
sunat-cli sire ventas archivo --ticket <ticket-id>    # downloads ZIP

# RCE (Compras)
sunat-cli sire compras propuesta --periodo 202504
sunat-cli sire compras importar --periodo 202504 --file ./compras.zip --yes
```

### REST APIs · `npm`

```bash
# OAuth2 token for the SUNAT REST APIs
sunat-cli api token
```

### Padrón RUC + Tipo de Cambio · `npm`

```bash
# Padrón RUC: download once (~370MB ZIP), then look up locally
sunat-cli padron status
sunat-cli padron sync
sunat-cli padron ruc 20123456789
sunat-cli padron batch --file ./rucs.csv

# Single RUC without syncing the padrón (drives the portal, ~5-10s)
sunat-cli padron ruc-online 20123456789

# Tipo de Cambio SBS
sunat-cli tipo-cambio --fecha hoy
sunat-cli tipo-cambio --fecha 2026-04-29 --output json
```

### Secrets · `npm`

Secrets resolve from the environment first, then the OS keychain. Existing
env-var setups keep working unchanged.

```bash
# Omit --value on a terminal and it prompts without echo, so the secret
# never lands in shell history
sunat-cli keychain set CPE_CERT_PASSWORD
sunat-cli keychain list
sunat-cli keychain clear CPE_CERT_PASSWORD
```

### Multi-emisor profiles · `npm`

```bash
sunat-cli cpe profile set --name acme --ruc 20123456789 --razon-social "ACME SAC" --mode beta
sunat-cli cpe profile list
sunat-cli cpe profile use acme
```

### Audit log · `npm`

```bash
# Inspect, optionally scoped to one emisor
sunat-cli audit list --ruc 20123456789 --limit 20

# Archive audit months older than the retention window
sunat-cli audit compact

# Delete archived months before a cutoff. Never runs on its own
sunat-cli audit prune --before 2025-01
```

### RHE / F616 (personas naturales) · `npm`

```bash
# Login (browser, no CAPTCHA)
sunat-cli login

# Schema
sunat-cli schema rhe

# Dry-run first
sunat-cli rhe emit --dry-run --json '{"empresa":"Acme Corp.","monto":5000,"moneda":"PEN","medioPago":"TRANSFERENCIA","tipoDoc":"SIN DOCUMENTO","descripcion":"Servicios"}'

# Batch emit
sunat-cli rhe emit --batch ./data/example.csv

# F616 mensual (periodo en YYYY-MM). El ingreso lo precarga SUNAT desde tus
# RHE registrados: el CLI no lo escribe, asi que verificalo en el portal
sunat-cli f616 declare --dry-run --json '{"periodo":"2026-03"}'
sunat-cli f616 declare --json '{"periodo":"2026-03"}'

# Varios periodos de una
sunat-cli f616 declare --batch --months 2025-03..2026-02 --dry-run

# Lecturas del F616 por API, headless (abre el navegador solo si el token vencio)
sunat-cli f616 periodo 2026-03
sunat-cli f616 oficios

# Fill the web form itself (T2). Needs the F616 open in the browser.
sunat-cli f616 declarar estado
sunat-cli f616 declarar periodo 2025-11
sunat-cli f616 declarar ingreso --fecha 17/11/2025 --monto 21054 --cliente "CLERK INC"
sunat-cli f616 declarar bandeja
sunat-cli f616 declarar constancias --dir ~/Downloads/constancias
```

## Design

Follows [Agent DX principles](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) and the [agentskills.io](https://agentskills.io) specification.

- `--params @file.json` over bespoke flags
- `--dry-run` for all mutations (T0/T1)
- `--yes` confirmation gate for irreversible ops (T2)
- Intent-token flow for destructive ops (T3, e.g. `cpe void`)
- `--output json` by default; NDJSON when piped
- `schema <command>` introspection at runtime (25+ schemas)
- Two-phase audit (`pending` → `success`/`error`) on every write
- Idempotency cache by natural key `RUC-tipo-serie-numero`
- Input hardening against agent hallucinations

## Headless after one login

SUNAT's monthly-declaration form looks server-rendered and behaves like one: driving the DOM never works, because the fields stay disabled until a background call returns. Underneath sits a JSON API, and reaching it needs a session token (`IdCache`) the portal mints only during its own browser login. A self-registered API client can never request that audience.

### Docs that cannot go stale

```bash
sunat-cli skills get core        # auth, RHE, F616, workflows
sunat-cli skills get schemas     # field specs
sunat-cli skills get endpoints   # the SUNAT endpoints behind each command
sunat-cli skills list
```

The agent skill installed on a machine is a thin stub that points here. Serving
the content from the binary means an agent always reads the docs for the version
it is actually running, instead of whatever was copied into `~/.claude/skills/`
months ago. Same idea as `agent-browser skills get core`.

### Declaring without emitting RHE

`f616 declarar` fills the web form directly, and that unlocks something the API path
cannot do: **the F616 does not require the RHE to exist**. Income rows are entered in
the form itself (Detalle de Ingresos, "Nuevo"), and that modal validates neither the
serie nor the número against the SEE, nor does it cap how far back the dates can go.
The electronic RHE issuer does cap it at two days, but declaring never goes through it.

Three things the form does not tell you, learned by hitting them:

- **Serie is four digits, no letter.** `E001` is rejected; `0001` works. The `E` belongs
  to the RHE filename, not to this field.
- **Serie, número and fecha de pago are required** even though they carry no asterisk.
- **Reload the form between periods.** Changing `casilla007` updates the value but does
  not rebuild the modal's validation rules, which stay bound to the previous period and
  reject the dates of the new one.

The interest in casilla 553 is **read, never computed**: SUNAT's rule does not reproduce
with TIM 0.9%/month from the due date (for 11/2025 it charges S/53 where the formula
gives S/124).

Nothing in `declarar` presents or pays. It leaves the form in the tray for a human to
submit.

So the CLI captures the token once from the browser, then reads the API headless for its hour of life. `f616 periodo` and `f616 oficios` open the browser only when the cached token is missing or expired; otherwise they are plain HTTP. Verified with zero browser processes running.

The OAuth2 surfaces (SIRE, GRE, CPE, buzón) need no browser at all: their token comes from a `password` grant against `api-seguridad.sunat.gob.pe` with a client registered from the SOL menu.

## Verification status

End-to-end verified against `e-beta.sunat.gob.pe` (2026-04-29):

- Factura · `cdrCode=0` Aceptado, hash deterministic
- Boleta · `cdrCode=0` Aceptado
- Nota Crédito · FC01-555 Aceptado (Catálogo 09)
- Nota Débito · FD01-777 Aceptado (Catálogo 10)
- GRE Remitente modal 02 · ticket polling + JWT refresh ok
- SIRE RVIE propuesta · ZIP descarga, parse correcto

**Producción (`e-factura.sunat.gob.pe`)**: never run blind. Always `preview` first, then `emit --dry-run`, then `--yes` only with real cert + RUC. See [`packages/cli/LIMITATIONS.md`](packages/cli/LIMITATIONS.md) for the full list of known boundaries.

## Roadmap

Tracked in GitHub issues — [milestones board](https://github.com/crafter-research/sunat-cli/issues).

| Priority | Issues |
|----------|--------|
| P0 — Now | [#18 Live verification against production](https://github.com/crafter-research/sunat-cli/issues/18) |
| P1 — Next | [#10 cpe void T3 + safety rail](https://github.com/crafter-research/sunat-cli/issues/10) · [#12 Drivers nubefact + apisperu](https://github.com/crafter-research/sunat-cli/issues/12) · [#11 GRE modal 01 + Transportista](https://github.com/crafter-research/sunat-cli/issues/11) |
| P2 — Later | [#13 Driver facturador](https://github.com/crafter-research/sunat-cli/issues/13) · [#14 SIRE reportes complementarios](https://github.com/crafter-research/sunat-cli/issues/14) · [#15 sqlite padrón index](https://github.com/crafter-research/sunat-cli/issues/15) · [#16 CI smoke jobs](https://github.com/crafter-research/sunat-cli/issues/16) · [#17 TUS auto-resume](https://github.com/crafter-research/sunat-cli/issues/17) |
| P3 — Backlog | [#30 F.1683 arrendamiento](https://github.com/crafter-research/sunat-cli/issues/30) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, safety boundaries, and focused
issues suitable for external contributors.

## Research

3 SUNAT portals reverse-engineered. F616 input mask cracked via raw CDP WebSocket. reCAPTCHA bypassed through OAuth state exploitation. UBL 2.1 + XAdES-BES manually implemented (xml-crypto v6 had nested-signature quirks).

Findings:
- [`packages/cli/src/commands/cpe/RESEARCH.md`](packages/cli/src/commands/cpe/RESEARCH.md) — CPE ecosystem dossier
- [`packages/cli/LIMITATIONS.md`](packages/cli/LIMITATIONS.md) — single source of truth for known boundaries

## Structure

```
packages/
  cli/       @crafter/sunat-cli — the CLI
  website/   sunat-cli.crafter.ing landing
```

## Releasing

Publishing is automatic. Bump `version` in `packages/cli/package.json` and merge
that PR to `main`. The release workflow then runs the test suite, publishes to
npm with OIDC trusted publishing (no token stored in the repo), installs the
published tarball to confirm it runs and exposes the expected commands, and
finally tags the commit and opens a GitHub Release.

A merge that leaves `version` untouched publishes nothing.

## License

[MIT](LICENSE), Copyright 2026 Crafter Research.
