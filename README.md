# sunat-cli

Agent-first CLI for SUNAT tax automation. Built for AI agents as primary consumers.

[sunat-cli.crafter.ing](https://sunat-cli.crafter.ing)

## What it does

- **RHE emission** — Batch emit Recibos por Honorarios via browser automation
- **F616 declaration** — Monthly 4ta categoria tax declarations
- **OAuth2 API** — Verify emissions via SUNAT REST API
- **Schema introspection** — Agents self-serve field definitions at runtime

## Requirements

- [Bun](https://bun.sh) v1.2+
- [agent-browser](https://github.com/vercel-labs/agent-browser) v0.22+
- Chrome or Chromium (agent-browser uses it via CDP)

## Install

```bash
bun add -g @crafter/sunat-cli
```

## Usage

```bash
# Login (no CAPTCHA)
sunat-cli login

# Introspect schema
sunat-cli schema rhe

# Dry-run first
sunat-cli rhe emit --dry-run --json '{"empresa":"Acme Corp.","tipoDoc":"SIN DOCUMENTO","descripcion":"Servicios de desarrollo","monto":5000,"moneda":"PEN","medioPago":"TRANSFERENCIA"}'

# Batch emit
sunat-cli rhe emit --batch ./data/example.csv

# OAuth2 token
sunat-cli api token --output json
```

## Design

Follows [Agent DX principles](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) and [agentskills.io](https://agentskills.io) specification.

- `--json` payloads over bespoke flags
- `--dry-run` for all mutations
- `--output json` by default (NDJSON when piped)
- Input hardening against hallucinations
- `SKILL.md` with progressive disclosure

## Research

3 SUNAT portals reverse-engineered. F616 input mask cracked via raw CDP WebSocket. reCAPTCHA bypassed through OAuth state exploitation. Full findings in [`RESEARCH.md`](packages/cli/RESEARCH.md).

## Structure

```
packages/
  cli/       @crafter/sunat-cli — the CLI tool
  website/   Astro landing page (sunat-cli.crafter.ing)
```

## License

MIT — [Crafter Station](https://crafterstation.com), Lima, Peru
