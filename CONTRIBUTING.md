# Contributing

Contributions are welcome. Start with an issue labeled [`good first issue`](https://github.com/crafter-research/sunat-cli/issues?q=state%3Aopen%20label%3A%22good%20first%20issue%22) or [`help wanted`](https://github.com/crafter-research/sunat-cli/issues?q=state%3Aopen%20label%3A%22help%20wanted%22), or open an issue before beginning a larger change.

## Setup

```bash
npm ci
bun test packages/cli/tests/unit
bun test packages/cli/tests/e2e
bun run packages/cli/bin/sunat.ts -o json cpe doctor
```

## Safety boundaries

- Never include real Clave SOL credentials, certificates, tokens, taxpayer records, or audit logs in an issue, fixture, commit, or pull request.
- Do not submit production tax documents as test evidence. Use offline fixtures, public read-only endpoints, mocks, or SUNAT beta surfaces where the issue explicitly requires live verification.
- Preserve `--dry-run`, `--yes`, intent-token, idempotency, and audit behavior when changing commands that can mutate external state.
- Document portal assumptions and failure modes. SUNAT interfaces can change without notice.

## Comments

Comments that document undocumented SUNAT behavior, manual sections, production verification, required parameters, runtime differences, privacy, safety, or implementation rationale are part of the maintenance contract. Preserve them during cleanup and refactors. Move or update them with the code when needed. Remove them only when they are inaccurate, obsolete, or redundant, and preserve any still-valid context in nearby code, tests, or documentation.

## Pull requests

Keep changes focused. Include the issue number, commands used for verification, any live surface tested, and known limitations. Changes to published behavior must update the README or [`packages/cli/LIMITATIONS.md`](packages/cli/LIMITATIONS.md) when relevant.
