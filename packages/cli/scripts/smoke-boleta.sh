#!/usr/bin/env bash
# Smoke test: emit a Boleta >= S/700 against SUNAT beta using public Greenter
# test cert. Verifies the boleta sendBill pipeline end-to-end.
#
# Run from packages/cli directory:
#   bash scripts/smoke-boleta.sh
# Or via npm script:
#   bun smoke:boleta

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

NUMERO=$(( ( RANDOM % 90000 ) + 10000 ))
echo "→ Emitting Boleta >= S/700 individually (B001-$NUMERO)..."
RESULT=$(bun run bin/sunat.ts -o json cpe --driver sunat-direct boleta emit --params "{
  \"receptor\":{\"tipoDoc\":\"1\",\"numDoc\":\"12345678\",\"rznSocial\":\"JUAN PEREZ TEST\"},
  \"items\":[{\"codigo\":\"P001\",\"descripcion\":\"Smoke boleta sunat-cli\",\"cantidad\":1,\"unidad\":\"ZZ\",\"valorUnitario\":1000,\"igvPct\":18}],
  \"totales\":{\"valorVenta\":1000,\"igv\":180,\"total\":1180},
  \"serie\":\"B001\",\"numero\":$NUMERO
}" --yes)

echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
console.log("  status:", r.status);
console.log("  cdrCode:", r.cdrCode);
console.log("  cdrDesc:", r.cdrDesc);
console.log("  id:", r.id);
if (r.cdrCode === "0" && r.status === "accepted") {
  console.log("\n✅ BOLETA SMOKE PASSED — SUNAT beta accepted the boleta individual");
  process.exit(0);
}
console.log("\n❌ BOLETA SMOKE FAILED");
process.exit(1);
'
