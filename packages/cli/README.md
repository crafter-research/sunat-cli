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

```bash
sunat-cli login                          # Auth (no CAPTCHA)
sunat-cli schema rhe                     # Introspect fields
sunat-cli rhe emit --dry-run --json '{}' # Preview
sunat-cli rhe emit --batch ./data.csv    # Batch emit
sunat-cli f616 declare --dry-run --json '{"periodo":"2025-03"}'
sunat-cli api token --output json        # OAuth2 token
```

## Design

- `--json` payloads over bespoke flags
- `--dry-run` for all mutations
- `--output json` by default (NDJSON when piped)
- Input hardening against hallucinations
- Schema introspection at runtime
- [agentskills.io](https://agentskills.io) compliant SKILL.md

## License

MIT — [Crafter Station](https://crafterstation.com)
