#!/usr/bin/env bash
# Smoke test: emit a real Factura against SUNAT beta using the public Greenter
# test cert. Verifies the full sunat-direct pipeline end-to-end.
#
# Run from packages/cli directory:
#   bash scripts/smoke-sunat.sh
# Or via npm script:
#   bun smoke:sunat

set -euo pipefail

CERT_DIR="${TMPDIR:-/tmp}"
CERT_PEM="$CERT_DIR/sunat-test.pem"
CERT_PFX="$CERT_DIR/sunat-test.pfx"
PROFILE_NAME="smoke-test"

if [ ! -f "$CERT_PFX" ]; then
  echo "→ Downloading public Greenter test cert..."
  curl -sSL https://raw.githubusercontent.com/thegreenter/greenter/master/packages/lite/tests/Resources/SFSCert.pem \
    -o "$CERT_PEM"
  echo "→ Converting PEM to PFX..."
  openssl pkcs12 -export \
    -in "$CERT_PEM" \
    -out "$CERT_PFX" \
    -password pass:test123 \
    -name "Greenter Test" 2>/dev/null
fi

echo "→ Setting smoke-test profile..."
bun run bin/sunat.ts -o json cpe profile set \
  --name "$PROFILE_NAME" \
  --ruc 20000000001 \
  --razon-social "EMPRESA DE PRUEBA" \
  --mode beta \
  --cert-path "$CERT_PFX" \
  --sol-usuario MODDATOS \
  > /dev/null

export CPE_PROFILE="$PROFILE_NAME"
export CPE_CERT_PASSWORD="test123"
export CPE_SOL_PASSWORD="moddatos"

echo "→ cpe doctor (sunat-direct, beta)..."
bun run bin/sunat.ts -o json cpe --driver sunat-direct doctor | bun -e '
const r = JSON.parse(await Bun.stdin.text());
console.log("  ok:", r.ok);
for (const c of r.checks) console.log("   ", c.ok ? "✓" : "✗", c.name, "—", c.detail);
'

NUMERO=$(( ( RANDOM % 90000 ) + 10000 ))
echo "→ Emitting Factura F001-$NUMERO..."
RESULT=$(bun run bin/sunat.ts -o json cpe --driver sunat-direct factura emit --params "{
  \"receptor\":{\"tipoDoc\":\"6\",\"numDoc\":\"20131312955\",\"rznSocial\":\"MINISTERIO DE EDUCACION\"},
  \"items\":[{\"codigo\":\"P001\",\"descripcion\":\"Smoke test sunat-cli\",\"cantidad\":1,\"unidad\":\"ZZ\",\"valorUnitario\":100,\"igvPct\":18}],
  \"totales\":{\"valorVenta\":100,\"igv\":18,\"total\":118},
  \"serie\":\"F001\",\"numero\":$NUMERO
}" --yes)

echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
console.log("  status:", r.status);
console.log("  cdrCode:", r.cdrCode);
console.log("  cdrDesc:", r.cdrDesc);
console.log("  id:", r.id);
if (r.cdrCode === "0" && r.status === "accepted") {
  console.log("\n✅ SMOKE PASSED — SUNAT beta accepted the factura");
  process.exit(0);
}
console.log("\n❌ SMOKE FAILED");
process.exit(1);
'
