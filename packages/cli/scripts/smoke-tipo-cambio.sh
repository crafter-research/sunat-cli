#!/usr/bin/env bash
# Smoke test: fetch a tipo de cambio from SUNAT with the build that ships.
#
# The WAF in front of e-consulta.sunat.gob.pe rejects requests that carry no
# Accept-Encoding header. Bun's fetch adds one on its own; Node's does not. So
# this test deliberately runs dist/sunat.js under node, not bin/sunat.ts under
# bun: the failure it guards against only exists in the published artifact.
#
# Run from packages/cli directory:
#   bash scripts/smoke-tipo-cambio.sh [YYYY-MM-DD]
# Or via npm script:
#   bun smoke:tipo-cambio
#
# No credentials needed: the endpoint is public.

set -euo pipefail

# A scratch state root, so the request is not answered from an operator's
# cache: a cache hit would pass this test without touching the network.
export SUNAT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sunat-smoke-tc.XXXXXX")"
trap 'rm -rf "$SUNAT_HOME"' EXIT

FECHA="${1:-$(date -v-7d +%F 2>/dev/null || date -d '7 days ago' +%F)}"

echo "→ Building dist/sunat.js..."
bun run scripts/build.ts >/dev/null

echo "→ node dist/sunat.js tipo-cambio --fecha $FECHA (fresh SUNAT_HOME, no cache)..."
# Errors are reported as JSON on stderr; capture both streams so the verdict
# below reads the real answer rather than an empty string.
RESULT=$(node dist/sunat.js -o json tipo-cambio --fecha "$FECHA" 2>&1 || true)
echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) {
  console.log("  error:", r.error);
  console.log("\n❌ TIPO-CAMBIO SMOKE FAILED");
  process.exit(1);
}
console.log("  fecha:", r.fecha);
console.log("  compra:", r.compra);
console.log("  venta:", r.venta);
if (typeof r.venta === "number" && r.venta > 0) {
  console.log("\n✅ TIPO-CAMBIO SMOKE PASSED");
  process.exit(0);
}
console.log("\n❌ TIPO-CAMBIO SMOKE FAILED: no venta rate in response");
process.exit(1);
'
