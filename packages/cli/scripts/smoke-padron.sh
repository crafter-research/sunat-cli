#!/usr/bin/env bash
# Smoke test: download SUNAT padrón reducido and lookup a known RUC.
# Run from packages/cli directory:
#   bash scripts/smoke-padron.sh
# Or via npm script:
#   bun smoke:padron
#
# WARNING: First run downloads ~370MB. Subsequent runs use the cache (24h TTL).

set -euo pipefail

KNOWN_RUC="20131312955" # SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA - SUNAT

echo "→ Padron status..."
bun run bin/sunat.ts -o json padron status

echo "→ Sync (downloads ~370MB if not cached)..."
bun run bin/sunat.ts -o json padron sync | bun -e '
const r = JSON.parse(await Bun.stdin.text());
console.log("  synced:", r.synced);
console.log("  size:", r.zipSizeHuman);
console.log("  entries:", r.entries);
console.log("  duration:", r.durationMs + "ms");
'

echo "→ Lookup $KNOWN_RUC (SUNAT)..."
RESULT=$(bun run bin/sunat.ts -o json padron ruc "$KNOWN_RUC")
echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
console.log("  found:", r.found);
console.log("  razonSocial:", r.razonSocial);
console.log("  estado:", r.estado);
console.log("  condicion:", r.condicion);
if (r.found && r.razonSocial.includes("SUNAT")) {
  console.log("\n✅ PADRON SMOKE PASSED");
  process.exit(0);
}
console.log("\n❌ PADRON SMOKE FAILED");
process.exit(1);
'
