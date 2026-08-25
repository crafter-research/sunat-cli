---
name: sunat-cli
description: "SUNAT tax automation for Peru from the terminal. Use when the user mentions SUNAT, RHE, recibo por honorarios, F616, renta anual, F709, factura or boleta electronica, CPE, SIRE, padron RUC, tipo de cambio SUNAT, or says emitir recibo, emitir factura, declarar F616, anular comprobante, impuestos Peru. Personas naturales with RUC 10 and empresas with RUC 20. Package @crafter/sunat-cli on npm."
---

# sunat-cli

SUNAT tax automation from the terminal, for agents to operate and humans to supervise.

Install: `npm install -g @crafter/sunat-cli`. Runs on Node, no Bun needed.

## Read the manual from the binary, not from here

This file exists so `npx skills add crafter-research/sunat-cli` finds something at
the repository root. It is a pointer, not the guide. The real content ships with
the CLI and always matches the version you have installed:

```bash
sunat-cli skills get core        # auth, RHE, F616, CPE, workflows
sunat-cli skills get schemas     # field specs per command
sunat-cli skills get endpoints   # the SUNAT endpoint behind each command
sunat-cli skills list
```

Serving docs from the binary is the point: a copy pasted into an agent directory
months ago describes a CLI that no longer exists, and nothing tells the reader it
drifted.

## Before anything else

```bash
sunat-cli doctor    # what is installed, what is missing, and the command that fixes it
```

RHE, F616 and the portal scrapers drive a real browser through
[agent-browser](https://github.com/vercel-labs/agent-browser), a separate binary:

```bash
npm install -g agent-browser      # all platforms
brew install agent-browser        # macOS
agent-browser install             # download Chrome, first time only
```

CPE, SIRE and GRE need a SUNAT certificate and a clave SOL instead.

## What it costs to get wrong

Every mutation is graded and the grade is in `--help`: T0 reads, T1 writes
locally, T2 files with SUNAT and needs `--yes`, T3 is irreversible and needs a
single-use intent token. Preview before you file; `--dry-run` calls the real path.

Production is beta throughout. Never run it blind.
