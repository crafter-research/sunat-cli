# @crafter/sunat-cli

Agent-first CLI for SUNAT tax automation. Built for AI agents as primary consumers.

[sunat-cli.crafter.ing](https://sunat-cli.crafter.ing) | [GitHub](https://github.com/crafter-research/sunat-cli)

## Requirements

- [Bun](https://bun.sh) v1.2+
- [agent-browser](https://github.com/vercel-labs/agent-browser) v0.22+
- Chrome or Chromium

## Install

```bash
bun add -g @crafter/sunat-cli
```

## Usage

Two namespaces, by RUC type:

### Personas naturales (RUC 10) — RHE + F616

```bash
sunat-cli login                          # Auth (no CAPTCHA)
sunat-cli schema rhe                     # Introspect fields
sunat-cli rhe emit --dry-run --json '{}' # Preview
sunat-cli rhe emit --batch ./data.csv    # Batch emit
sunat-cli f616 declare --dry-run --json '{"periodo":"2025-03"}'
sunat-cli api token --output json        # OAuth2 token
```

### SIRE — Registro de Ventas (RVIE) y Compras (RCE)

Mandatory monthly tax filing automation. Replaces the SOL portal SIRE workflow.

```bash
# Setup (once)
export SUNAT_API_CLIENT_ID=...   # SOL → Credenciales API SUNAT, URI = "MIGE RCE y RVIE - SIRE"
export SUNAT_API_CLIENT_SECRET=...
export SUNAT_RUC=...
export SUNAT_USER=...
export SUNAT_PASSWORD=...

# Monthly RVIE (Ventas)
sunat-cli sire ventas periodos
sunat-cli sire ventas propuesta --periodo 202404 --wait --out propuesta-202404.zip
sunat-cli sire ventas aceptar --periodo 202404 --yes
sunat-cli sire ventas descargar --periodo 202404 --wait --out rvie-202404.zip

# RCE (Compras) — same flow
sunat-cli sire compras periodos
sunat-cli sire compras propuesta --periodo 202404 --wait --out compras-202404.zip
```

### Padrón Reducido del RUC (offline lookup, no auth)

```bash
sunat-cli padron sync                  # ~370MB download, refreshes daily
sunat-cli padron ruc 20131312955       # razon social, estado, condicion
sunat-cli padron batch --file rucs.csv # batch lookup from CSV
```

### CPE Consulta Integrada (REST OAuth)

Validate any CPE (mine or vendor's) against SUNAT records.

```bash
export SUNAT_API_CLIENT_ID=...   # from SOL → Mi RUC → Credenciales API
export SUNAT_API_CLIENT_SECRET=...

sunat-cli cpe consulta \
  --ruc-emisor 20131312955 --tipo 01 --serie F001 --numero 1234 \
  --fecha 2026-04-29 --monto 118
```

### Empresas (RUC 20) — CPE

For empresas emitting Factura, Boleta, NC, ND, Guia. Pluggable backend
via `--driver mock|sunat-direct|facturador|nubefact|apisperu`.

| Driver | Status | Notes |
|--------|--------|-------|
| `mock` | ✅ wired | Default. In-memory, deterministic. Use for dev/agents/tests. |
| `sunat-direct` | ✅ verified end-to-end | Native SOAP + XAdES-BES TS. Factura + Boleta (individual + resumen diario) + Comunicación de Baja. Hits `e-beta.sunat.gob.pe` directly. CDR responseCode=0 (Aceptado) confirmed 2026-04-29. |
| `facturador` | shaped | Will wrap containerized Java Facturador SUNAT. |
| `nubefact`, `apisperu` | shaped | OSE/PSE adapters. |

```bash
# Mock (no setup)
sunat-cli cpe doctor
sunat-cli cpe factura preview --params '{...}'
sunat-cli cpe factura emit --params '...' --yes

# sunat-direct (real SUNAT beta or prod)
sunat-cli cpe profile set --name beta --ruc 20131312955 \
  --razon-social "ACME SAC" --mode beta --cert-path /abs/cert.pfx \
  --sol-usuario MODATOS1 --default
export CPE_PROFILE=beta CPE_CERT_PASSWORD=... CPE_SOL_PASSWORD=...
sunat-cli cpe --driver sunat-direct doctor
sunat-cli cpe --driver sunat-direct factura emit --params '...' --yes

# Quick smoke tests against SUNAT beta with public Greenter test cert
bun smoke:sunat   # Factura individual end-to-end
bun smoke:boleta  # Boleta >= S/700 individual end-to-end

# Boleta workflow (>= S/700 individual, < S/700 daily summary)
sunat-cli cpe boleta emit --params '...' --yes
sunat-cli cpe boleta queue --params '...'
sunat-cli cpe --driver sunat-direct resumen send --fecha 2026-04-29 --yes --wait

# Comunicación de Baja (anular CPE)
sunat-cli cpe --driver sunat-direct baja send --params '{
  "fechaEmisionDocs":"2026-04-29",
  "entries":[{"tipoDoc":"03","serie":"B001","numero":100,"motivo":"x"}]
}' --yes --wait
```

Trust ladder: T0 read/preview, T2 emit (requires `--yes`), T3 void (requires
`--intent-token` from `cpe void prepare`).

Idempotency: every emit is keyed by `RUC-tipo-serie-numero`. Re-running with the
same key returns the cached CDR without re-submitting to SUNAT. Audit log lives
in `~/.sunat/audit/YYYY-MM-DD.jsonl` (two-phase: pending → success/error).

Full shaping rationale + recon dossier + SUNAT debugging notes:
`src/commands/cpe/RESEARCH.md`.

## Design

- `--json` payloads over bespoke flags
- `--dry-run` for all mutations
- `--output json` by default (NDJSON when piped)
- Input hardening against hallucinations
- Schema introspection at runtime
- [agentskills.io](https://agentskills.io) compliant SKILL.md

## Limitations & known issues

See [`LIMITATIONS.md`](./LIMITATIONS.md) for the single source of truth:
what's stubbed, what's blocked by SUNAT WAF, what's verified end-to-end,
what's pending live verification with real production credentials.

## License

MIT — [Crafter Station](https://crafterstation.com)
