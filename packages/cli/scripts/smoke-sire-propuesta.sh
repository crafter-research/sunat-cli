#!/usr/bin/env bash
# Smoke test: download the RVIE and RCE proposals for a period, end to end, with
# the build that ships (node dist/sunat.js, not bun bin/sunat.ts).
#
# One command per book does the three steps SUNAT requires: ask for the export
# (Manual API Registro de Ventas v30 §5.18 / Manual SIRE Compras v28 §5.34),
# poll the ticket by period (§5.16), download the file it produced (§5.17). The
# result must be a ZIP.
#
# Needs real SIRE credentials in the environment, the same five the CLI reads:
#   SUNAT_API_CLIENT_ID, SUNAT_API_CLIENT_SECRET, SUNAT_RUC, SUNAT_USER, SUNAT_PASSWORD
# It skips, without failing, when they are absent. It prints ticket numbers and
# byte counts only: no RUC, no names, no amounts. The downloaded files are
# deleted on exit.
#
# Run from packages/cli directory:
#   bash scripts/smoke-sire-propuesta.sh [YYYYMM]     # default: previous month
# Or via npm script:
#   bun smoke:sire-propuesta

set -euo pipefail

for v in SUNAT_API_CLIENT_ID SUNAT_API_CLIENT_SECRET SUNAT_RUC SUNAT_USER SUNAT_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "⏭  $v not set — SIRE smoke skipped (needs real SIRE credentials)."
    exit 0
  fi
done

export SUNAT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sunat-smoke-sire.XXXXXX")"
trap 'rm -rf "$SUNAT_HOME"' EXIT

PERIODO="${1:-$(date -v-1m +%Y%m 2>/dev/null || date -d 'last month' +%Y%m)}"

echo "→ Building dist/sunat.js..."
bun run scripts/build.ts >/dev/null

FAILED=0
for LIBRO in ventas compras; do
  OUT="$SUNAT_HOME/$LIBRO-$PERIODO.zip"
  echo "→ node dist/sunat.js sire $LIBRO propuesta --periodo $PERIODO --wait --out …/$LIBRO-$PERIODO.zip"
  RESULT=$(node dist/sunat.js -o json sire "$LIBRO" propuesta --periodo "$PERIODO" --wait --out "$OUT" 2>&1 || true)
  echo "$RESULT" | bun -e '
const [libro, out] = process.argv.slice(1);
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) { console.log(`  ${libro}: ✗ ${r.error}`); process.exit(1); }
if (r.state !== "completed" || !r.file) { console.log(`  ${libro}: ✗ ticket ${r.numTicket ?? "?"} ended as ${r.state ?? "unknown"} (${r.statusDesc ?? ""})`); process.exit(1); }
const bytes = await Bun.file(out).arrayBuffer();
const head = new Uint8Array(bytes.slice(0, 2));
if (head[0] !== 0x50 || head[1] !== 0x4b) { console.log(`  ${libro}: ✗ ticket ${r.numTicket}: downloaded ${bytes.byteLength} bytes but not a ZIP`); process.exit(1); }
console.log(`  ${libro}: ✓ ticket ${r.numTicket} → ZIP, ${bytes.byteLength} bytes`);
' "$LIBRO" "$OUT" || FAILED=1
done

if [ "$FAILED" -eq 0 ]; then
  echo; echo "✅ SIRE PROPUESTA SMOKE PASSED (both proposals downloaded as ZIP)"
else
  echo; echo "❌ SIRE PROPUESTA SMOKE FAILED"; exit 1
fi
