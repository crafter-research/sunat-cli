# sunat-cli

SUNAT tax automation from the terminal, in Peru. Built for AI agents to operate and humans to supervise.

[![npm](https://img.shields.io/npm/v/@crafter/sunat-cli?label=npm)](https://www.npmjs.com/package/@crafter/sunat-cli)
[![Release](https://img.shields.io/github/v/release/crafter-research/sunat-cli?display_name=tag&sort=semver&label=release)](https://github.com/crafter-research/sunat-cli/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Built with Crafter Station](https://img.shields.io/badge/built%20with-Crafter%20Station-orange)](https://crafterstation.com)
[![sunat-cli.crafter.ing](https://img.shields.io/badge/site-sunat--cli.crafter.ing-black)](https://sunat-cli.crafter.ing)

## Install

```bash
npm install -g @crafter/sunat-cli
sunat-cli --help
```

That help output is the contract. Every command it prints exists in the version you have.

Runs on Node, no Bun needed.

RHE, F616 and the portal scrapers drive a real browser through [agent-browser](https://github.com/vercel-labs/agent-browser), a separate binary:

```bash
npm install -g agent-browser      # all platforms
brew install agent-browser        # macOS
agent-browser install             # download Chrome, first time only
```

CPE, SIRE and GRE need a SUNAT digital certificate (PFX) and a clave SOL instead. Everything else works with neither.

Run `sunat-cli doctor` to see what is present and what each gap needs.

## Quick start

```bash
# What a command accepts, as data instead of --help text
sunat-cli schema f616

# Read-only, no session needed
sunat-cli padron ruc 20100070970
sunat-cli tipo-cambio

# Log in once, then everything else runs headless
sunat-cli login
sunat-cli whoami
sunat-cli buzon list
sunat-cli buzon status
```

Output is JSON whenever stdout is not a terminal, so an agent gets parseable data without passing a flag. On a terminal you get a human view.

## Commands

Sixteen namespaces. Run `sunat-cli <name> --help` for any of them.

| Namespace | What it does |
|---|---|
| `login`, `whoami`, `keychain` | authenticate and inspect the session |
| `doctor` | what is installed, what is missing, and the command that fixes it |
| `schema` | field specs per command, for agents |
| `skills` | the agent manual, served by the binary |
| `rhe`, `f616` | recibos por honorarios and the monthly declaration (personas naturales) |
| `cpe` | factura, boleta, nota de crédito and débito, GRE, resumen diario, baja |
| `sire` | RVIE ventas and RCE compras |
| `renta` | renta anual F709, read-only |
| `buzon` | Buzón SOL metadata and local change detection, read-only |
| `padron` | RUC lookup against a local copy of the padrón |
| `tipo-cambio` | official SUNAT exchange rate |
| `api` | OAuth2 token for the REST APIs |
| `audit` | the local write log |

## Safety

Every mutation is graded, and the grade appears in `--help`:

| Tier | Meaning |
|---|---|
| T0 | read-only, no side effects |
| T1 | writes locally |
| T2 | files with SUNAT, requires `--yes` |
| T3 | irreversible, requires a single-use intent token |

Preview before you file. `--dry-run` exists on every mutation and calls the real path, so what it returns is what would happen.

Writes leave a receipt. The audit log records a pending entry before the network call and the result after, so a process killed mid-flight leaves evidence instead of silence.

```bash
sunat-cli cpe factura preview --params "$(cat factura.json)"      # T0
sunat-cli cpe factura emit --params "$(cat factura.json)" --yes   # T2
sunat-cli audit list
```

Production is beta. Never run it blind.

## Coverage

Ten SUNAT surfaces, at different depths. Reads are solid; the write paths vary, and production is beta throughout. The per-surface breakdown is on [the website](https://sunat-cli.crafter.ing#coverage).

[LIMITATIONS.md](packages/cli/LIMITATIONS.md) is the single source of truth for what does not work yet. Read it before trusting a write path.

## Design

Follows [Agent DX principles](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) and the [agentskills.io](https://agentskills.io) spec.

- `--params <json>` on `cpe` commands, instead of one flag per field
- `schema <command>` for runtime introspection, so an agent never parses `--help`
- JSON when stdout is not a TTY, without a flag
- data on stdout, diagnostics on stderr
- `nextSteps` on stderr, naming what to run next
- two-phase audit on every write
- idempotency by natural key, `RUC-tipo-serie-numero`
- input hardening against hallucinated values

### Docs that cannot go stale

```bash
sunat-cli skills get core        # auth, RHE, F616, workflows
sunat-cli skills get schemas     # field specs
sunat-cli skills get endpoints   # the SUNAT endpoint behind each command
```

The skill installed on a machine is a stub that points here. Serving docs from the binary means an agent reads the docs for the version it is running, rather than whatever got copied into `~/.claude/skills/` months ago.

### Local after one login

SUNAT's monthly declaration form looks server-rendered and behaves like one. Driving the DOM never works, because the fields stay disabled until a background call returns. Underneath sits a JSON API, and reaching it needs a session token the portal mints only during its own browser login. A self-registered API client cannot request that audience.

So: log in once through the browser. API-backed reads run headless with a cached token. `buzon list` opens a local browser session because the legacy visor keeps its authentication inside a cross-origin frame, blocks the detail endpoint, reads metadata, saves a private snapshot, and closes the page.

### Declaring without emitting RHE

`f616 declarar` fills the web form directly, which the API path cannot do. The F616 does not require the RHE to exist: income rows are entered in the form itself, and that modal validates neither the receipt nor the payer. Useful when you owe a declaration for a period whose receipts were never issued electronically.

## Contributing

Start from an issue and keep one issue per branch and pull request. Contributors
with write access can push a branch directly to this repository; `main` remains
protected.

Open a draft pull request as soon as the initial structure is ready so scope and
direction can be reviewed before the implementation is complete. Every pull
request should link its issue, include the verification commands that were run,
and add screenshots when it changes the website.

Never use real SUNAT credentials, certificates, tokens, taxpayer records, or
production submissions as test evidence.

```bash
bun install
bun test
biome check --write .
```

Findings from reverse-engineering SUNAT's surfaces are in [RESEARCH.md](packages/cli/src/commands/cpe/RESEARCH.md).

## Releasing

Bump `version` in `packages/cli/package.json` and merge to `main`. The workflow runs the suite, publishes to npm with OIDC trusted publishing (no token in the repo), verifies the published tarball runs, then tags the commit and opens a release.

A merge that leaves `version` untouched publishes nothing.

## License

[MIT](LICENSE), Copyright 2026 Crafter Research.
