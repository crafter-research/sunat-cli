# @crafter/sunat-cli

Agent-first CLI for SUNAT tax automation. Built for AI agents as primary consumers.

[sunat-cli.crafter.ing](https://sunat-cli.crafter.ing) | [GitHub](https://github.com/crafter-research/sunat-cli)

## Requirements

- [Bun](https://bun.sh) v1.2+
- [agent-browser](https://github.com/vercel-labs/agent-browser) v0.22+
- Chrome or Chromium

## Install

```bash
npm install -g @crafter/sunat-cli
```

## Usage

Selected surfaces:

### Personas naturales (RUC 10) — RHE + F616

```bash
sunat-cli login                          # Auth (no CAPTCHA)
sunat-cli schema rhe                     # Introspect fields
sunat-cli rhe emit --params '{"empresa":"Cliente","descripcion":"Servicio","monto":100}' --dry-run
sunat-cli rhe emit --params '{"empresa":"Cliente","descripcion":"Servicio","monto":100}' --preview-only
sunat-cli rhe emit --params '{"empresa":"Cliente","descripcion":"Servicio","monto":100}' --yes --live-sunat
sunat-cli rhe emit --params '{"empresa":"Cliente","descripcion":"Servicio","monto":100}' --yes --live-sunat --artifacts-dir /absolute/path/rhe
sunat-cli f616 declare --dry-run --params '{"periodo":"2025-03"}'
sunat-cli api token --output json        # Validate OAuth2 credentials without printing the token
```

RHE is hybrid: a headed SOL session mints the entry URL, direct HTTP reaches the
legally invalid preview, and the final browser confirmation remains gated. Once
issued, the same session downloads and validates the XML and PDF. The JSON result
contains their private local paths and reports artifact errors separately from
the legal issuance status.

### Buzón SOL metadata (read-only)

```bash
sunat-cli login
sunat-cli buzon list --max-pages 25
sunat-cli buzon status
sunat-cli schema buzon
```

`buzon list` reads message and notification metadata through the local SOL browser session. The detail endpoint is blocked before the visor loads, so bodies and read-state mutations cannot reach SUNAT. It stores a private `~/.sunat/buzon/state.json` snapshot to detect new identities on the next run. `buzon status` reads that snapshot offline.

The first run establishes a baseline. No item is marked new until a later run sees an identity absent from the prior snapshot. Reported totals are preserved separately from observed rows because the legacy visor can contradict itself.

### Declaraciones presentadas y constancias (read-only)

```bash
sunat-cli login
sunat-cli declaraciones list --desde 01/06/2026 --hasta 27/08/2026
sunat-cli declaraciones list --formulario 0601 --periodo 202607
sunat-cli declaraciones constancia <numOrden> --formulario 0601 --out constancia-0601-202607.pdf
sunat-cli schema declaraciones
```

`declaraciones list` reads SOL's "Consulta de declaraciones juradas y pagos" (menu `12.1.1.1.4`) through the local SOL browser session and lists every declaration and NPS payment presented in the range: 0621, 0601 PLAME, 0710, 1663… SUNAT caps the window at six months; the default is the last 90 days. `--formulario` and `--periodo` filter locally. `declaraciones constancia` downloads the constancia de presentación PDF for a número de orden; it is written with mode `0600`. Nothing here files, pays or amends.

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

# Replace SUNAT's proposal with your own .zip (TUS.IO upload, chunked 8MB)
sunat-cli sire ventas reemplazar --periodo 202404 --file mi-propuesta.zip --yes --wait

# Import extra comprobantes (--tipo: propuesta | preliminar | ajustes | ajustes-anteriores)
sunat-cli sire ventas importar --periodo 202404 --file extra.zip --tipo propuesta --yes --wait

# RCE (Compras) — same flow
sunat-cli sire compras periodos
sunat-cli sire compras propuesta --periodo 202404 --wait --out compras-202404.zip
```

For local use, prefer `sunat-cli keychain set <KEY>`. Secrets are accepted through hidden prompts or environment variables, never CLI value flags.

### Guía de Remisión Electrónica (GRE — REST OAuth)

```bash
export SUNAT_GRE_CLIENT_ID=...   # SOL → Credenciales API SUNAT, URI = "GRE Emisión de Comprobantes"
export SUNAT_GRE_CLIENT_SECRET=...

sunat-cli schema cpe-gre

sunat-cli cpe gre emit --params '{
  "serie": "T001", "numero": 1, "fechaEmision": "2026-04-29",
  "destinatario": {"tipoDoc":"6","numDoc":"20100070970","rznSocial":"CLIENTE SAC"},
  "envio": { ... codTraslado, modTraslado=02, chofer, vehiculo, partida, llegada },
  "items": [{"codigo":"P001","descripcion":"Cajas","cantidad":10,"unidad":"NIU"}]
}' --yes --wait

sunat-cli cpe gre status --ticket 20240100000001 --wait
```

### Tipo de Cambio oficial SUNAT (USD/PEN)

```bash
sunat-cli tipo-cambio                       # today's USD/PEN
sunat-cli tipo-cambio --fecha 2026-04-15    # historical, immutable
sunat-cli tipo-cambio cached --fecha 2026-04-15
```

Scrapes the SUNAT portal via agent-browser (WAF blocks direct fetch).
Cached forever per date.

### Padrón Reducido del RUC (offline lookup, no auth)

```bash
sunat-cli padron ruc-online 20131312955   # single RUC via portal (no sync needed)
```

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
in `~/.sunat/audit/YYYY-MM.jsonl` (two-phase: pending → success/error). Older
months can be compacted into `~/.sunat/audit/archive/YYYY-MM.jsonl.gz` with
`sunat-cli audit compact`, and archived months can be removed manually with
`sunat-cli audit prune --before YYYY-MM`.

Audit persistence is minimized: command arguments are not retained, taxpayer and document identifiers use keyed references, and legacy screenshots are deleted during migration.

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
