#!/usr/bin/env bash
# Smoke test: query a known public RUC through the live SUNAT portal.
# Requires agent-browser + its installed Chrome runtime.
#
# Run from packages/cli directory:
#   bash scripts/smoke-ruc-online.sh
#
# No credentials needed: Consulta RUC is public.

set -euo pipefail

export SUNAT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sunat-smoke-ruc.XXXXXX")"
trap 'rm -rf "$SUNAT_HOME"' EXIT

KNOWN_RUC="20131312955"

echo "→ bun run bin/sunat.ts padron ruc-online $KNOWN_RUC..."
RESULT=$(bun run bin/sunat.ts -o json padron ruc-online "$KNOWN_RUC" 2>&1 || true)
echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) {
  console.log("  error:", r.error);
  console.log("\n❌ RUC-ONLINE SMOKE FAILED");
  process.exit(1);
}
console.log("  found:", r.found);
console.log("  ruc:", r.ruc);
console.log("  razonSocial:", r.razonSocial);
const ok =
  r.found === true &&
  r.ruc === "20131312955" &&
  typeof r.razonSocial === "string" &&
  r.razonSocial.toUpperCase().includes("SUNAT");
if (ok) {
  console.log("\n✅ RUC-ONLINE SMOKE PASSED");
  process.exit(0);
}
console.log("\n❌ RUC-ONLINE SMOKE FAILED: known SUNAT RUC did not match expected identity");
process.exit(1);
'
