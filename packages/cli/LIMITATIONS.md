# sunat-cli — Limitations & Known Issues

Single source of truth for everything that's deliberately stubbed, deferred,
blocked by SUNAT/WAF, or pending verification with real production credentials.
Updated each PR. Anything **not** in here should Just Work™.

If you hit something that's not documented here, open an issue.

---

## Quick legend

- **🚧 Shaped, not implemented** — interface exists, returns clear error. Future PR.
- **⛔ Blocked by SUNAT** — endpoint or path actively rejects our requests; needs alternate approach.
- **⚠️ Verified shape, untested live** — code matches official SUNAT manual but never executed against real prod.
- **🔬 Verified end-to-end** — confirmed working against real SUNAT (beta or test cert).

---

## CPE / Emission (PRs #1, #2)

### Driver matrix

| Driver | Factura | Boleta | NC/ND | Guia | Resumen Diario | Comunicación Baja |
|--------|---------|--------|-------|------|----------------|-------------------|
| `mock` | 🔬 | 🔬 | 🔬 | 🚧 | 🚧 | 🚧 |
| `sunat-direct` | 🔬 | 🔬 (≥S/700 individual) | 🚧 | 🚧 | ⚠️ XML verified, send blocked by WAF on test RUC | ⚠️ XML verified, untested live |
| `facturador` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 |
| `nubefact` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 |
| `apisperu` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 |

### Active limitations

- **NC, ND** — driver methods throw "not yet implemented" errors. UBL builders shaped in `src/cpe/ubl/`, signer + SOAP infra reusable. Estimated 1 day each. **Future PR**.
- **Guía de Remisión Electrónica (GRE)** — ✅ shipped in PR #7 as `sunat cpe gre emit|status` (REST OAuth, NOT SOAP). Reuses XAdES signer. **However**:
  - ⚠️ Untested live (needs SUNAT_GRE_CLIENT_ID/SECRET from SOL menu URI = "GRE Emisión de Comprobantes")
  - 🚧 Only modTraslado=02 (transporte privado, emisor moves goods). Modal 01 (transporte público / carrier party) → next PR
  - 🚧 No `BuyerCustomerParty` (when distinto del destinatario)
  - 🚧 No `SellerSupplierParty` (tercero/proveedor)
  - 🚧 No `AdditionalDocumentReference` (factura previa, etc)
  - 🚧 GRE Transportista (tipo doc 31) — different schema, not implemented
  - 🚧 Multiple choferes — schema accepts loop, only one supported in PR #7
- **`sunat cpe void` (T3)** — intent-token flow shaped, command stubbed. Voiding is currently done via Comunicación de Baja (`sunat cpe baja send`) for boletas or NC for facturas. **Future PR**.
- **Resumen Diario `sendSummary` against SUNAT beta** — XML structure 100% verified against Greenter twig template; unit tests cover all 14 structural assertions. **However**, the actual SUNAT beta nginx wrapper returns transient HTTP 401 on the `/sendSummary` path with the public test RUC `20000000001`. `sendBill` calls in the same window work fine. Hypothesis: rate-limit specific to the RC endpoint on the shared test RUC. **Production cert + RUC will not see this.** Documented in `src/commands/cpe/RESEARCH.md` appendix.
- **Drivers `facturador`, `nubefact`, `apisperu`** — `getDriver()` returns a clear "shaped but not implemented" error. The `facturador` driver requires coordination on the API shape of a containerized Java Facturador wrapper. The other two are PSE/OSE adapters; useful when the user wants to keep their existing OSE while gaining the CLI UX.
- **Catálogos SUNAT minimal** — codigos producto (Cat 02), unidades (Cat 03 — currently using `ZZ`/`NIU` only), tipos doc (Cat 06), etc. Working set is hardcoded for the most common cases. Full catalog import is a separate PR.
- **Producción (`e-factura.sunat.gob.pe`)** — never tested. All verifications were against `e-beta.sunat.gob.pe`. Switching `--mode prod` should work but **never run prod without dry-run + careful first emission**.

### Verified end-to-end against SUNAT beta (2026-04-29)

- ✅ `cpe factura emit --driver sunat-direct` → `cdrCode=0` Aceptado
- ✅ `cpe boleta emit --driver sunat-direct` (≥S/700) → `cdrCode=0` Aceptado
- ✅ Idempotency cache (re-emit same serie+numero returns cached CDR)

---

## SUNAT REST OAuth APIs (PR #3)

### Padrón RUC

- ✅ **Local padrón download + lookup** — verified end-to-end (PR #3 smoke test).
- ⚠️ **`padron ruc-online` via SUNAT portal** (PR #8) — agent-browser drives `e-consultaruc.sunat.gob.pe` (bypasses the `numRnd` + reCAPTCHA gate that broke direct fetch). Pure parser unit-tested with 7 fixture cases. Live scraping untested in CI (no Chrome) — verify post-merge by running `sunat padron ruc-online 20131312955`. **For batch use always prefer local padrón** (`padron ruc/batch`) — `ruc-online` is ~5-10s per RUC.

### Tipo de Cambio

- ⚠️ **`sunat tipo-cambio` via SUNAT portal** (PR #8) — agent-browser scrapes `e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias` (the WAF blocks direct fetch but allows headless Chrome via DevTools). Pure parser unit-tested with 7 fixture cases. Cache: `~/.sunat/cache/tipo-cambio.jsonl` keyed by ISO date (immutable per date, cached forever).
- ⛔ **SBS `sbs.gob.pe`** — also blocked by WAF, NOT bypassed in PR #8 (SUNAT's own TC is the legally-valid one for tax purposes anyway).
- 🚧 **Live scraping untested in CI** (no Chrome). Verify post-merge by running `sunat tipo-cambio` and confirm a reasonable USD/PEN value comes back.
- 🚧 **No automatic fallback** — if SUNAT changes the table layout, the parser returns null. The error message hints at running with debug to inspect the snapshot. Future PR could add a third-party fallback (with explicit user opt-in via env var).

### Consulta CPE Integrada

- ⚠️ **`sunat cpe consulta`** — code matches Greenter's openapi spec. Not yet tested live because it requires `SUNAT_API_CLIENT_ID/SECRET` from a real RUC's SOL menu (the shared test RUC doesn't have these credentials). When you set those env vars, should work first call.

---

## SIRE — Registro de Ventas / Compras (PR #4)

### Verified shapes (untested live)

All endpoints follow Manual de Servicios Web Api SIRE Ventas v22 (March 2024) at the byte level. Unit tests cover URL paths, request methods, body shapes, and OAuth password grant flow.

### Active limitations

- ⚠️ **Never tested against real SIRE.** Same reason as Consulta CPE: needs real RUC with SIRE credentials + active billing periods. The Greenter test RUC `20000000001` has no RVIE history. When you run the first time with your own creds + a periodo with data, `propuesta --wait --out X.zip` should give you the working ZIP.
- ⚠️ **`reemplazar propuesta` + `importar comprobantes`** (PR #6) — TUS.IO 1.0.0 client implemented in TS (`src/sunat-rest/tus.ts`), 15 unit tests cover POST/PATCH/HEAD + chunking + metadata base64 encoding. Wired as `sunat sire {ventas|compras} {reemplazar|importar --tipo X}`. **However, ticket extraction from the upload Location URL is best-effort**: SUNAT's response shape varies and the manual is ambiguous. If `numTicket` comes back empty, the upload itself succeeded but the operator must poll `consultaestadotickets` manually using `perTributario` + `codProceso`. To verify in prod: upload a tiny test ZIP first with `--wait` and check whether the ticket round-trips.
- 🚧 **Reportes complementarios** (resumen, inconsistencias, CAR, casillas, reporte de exportadores, reporte de cumplimiento, reporte estadístico) — same async ticket pattern as `propuesta`. Easy adds when needed.
- 🚧 **Tipo de cambio masivo** — JSON POST endpoint, easy add.
- 🚧 **Eliminar comprobantes** (propuesta / preliminar / reemplazo) — same shape, low priority.
- ⚠️ **CORS warning from SUNAT** — "los servicios del API SIRE no deben ser consumidos desde un cliente Web". CLI is server-side, not affected. Don't try to call these from a browser bundle.

### TUS.IO implementation notes (PR #6)

- **TUS spec version**: `1.0.0`
- **Chunk size**: default 8 MB, override with `--chunk-size <bytes>`. Configured per upload.
- **File size limit**: 6 GB enforced client-side per SUNAT spec (Manual error 1346)
- **Metadata encoding**: keys uncoded, values base64. SUNAT-required keys: `filename, filetype, perTributario, codOrigenEnvio (=2), codProceso, codTipoCorrelativo (=01), nomArchivoImportacion, codLibro`
- **codProceso values** (Anexo I — Indicador de carga masiva):
  - `1` = Importar CP propuesta
  - `3` = Reemplazo de la propuesta
  - `4` = Importar CP preliminar
  - `6` = Cargar Ajustes posteriores
  - `7` = Cargar Ajustes posteriores anteriores a la vigencia
- **Resumability**: TUS supports HEAD-then-resume on partial uploads, but PR #6 does not implement automatic retry-from-last-offset on network errors. If a large upload fails mid-flight, re-run the whole command. Future PR can add resumption.
- **Why we ignored SUNAT's "JAVA required" note**: SUNAT only ships Java samples. The TUS protocol itself is HTTP-only, language-agnostic. Verified by spec review.

---

## RHE / F616 — Personas Naturales (legacy, pre-existing)

These predate the agent-first refactor and use the older agent-browser scraping path. Not part of recent PRs but documenting for completeness:

- ⚠️ **Browser scraping** — uses `agent-browser` to drive the SOL portal directly. Brittle to UI changes. Currently working but expect maintenance.
- ⚠️ **reCAPTCHA via mouse coordinates** — F616 (Nueva Plataforma) requires solving reCAPTCHA. Solved via coordinate injection. Documented as fragile in `CLAUDE.md`.
- ✅ **RHE emission** — verified working, used by Hunter monthly for Clerk income.
- ✅ **F616 declaration** — verified working, used by Hunter monthly.

---

## Cross-cutting

### Testing gaps

- **Production submissions** never tested. Always use `--mode beta` (or its equivalent) until you've manually verified one production emission.
- **Stress / rate-limit tests** never run. SUNAT WAF behavior under load is unknown.
- **Multi-RUC** — config file supports profiles, but never tested with multiple active RUCs in the same process.
- **Cert expiry** — `cpe doctor` warns at <30 days. Never tested with an actually-expired cert.

### Environment

- **Java not bundled** — driver `facturador` (when implemented) will assume Java 8u202+ already running in a sibling container. Not auto-installed.
- **Bun-only** — code uses Bun-native APIs (`Bun.spawn`, `crypto.subtle`, native fetch). Won't run on plain Node without porting.
- **macOS / Linux only** — Windows untested. Path handling uses `~/.sunat/` style; tests use `tmpdir()`. Should work on Windows in theory but no CI for it.

### Audit / observability

- **Audit log under `~/.sunat/audit/`** — never rotated. Will grow unbounded over time.
- **No remote telemetry** — by design. Everything stays on disk.
- **`cpe doctor` stale-pending check** — alerts when audit has `pending` entries >1h old. Cleanup is manual (user decides whether to retry, void, or just delete).

### Security

- **Cert PFX password** — read from env var `CPE_CERT_PASSWORD`. Never persisted on disk. Never logged.
- **SOL password** — read from env var `CPE_SOL_PASSWORD` / `SUNAT_PASSWORD`. Never persisted. Never logged.
- **API client_secret** — read from env var. Never persisted. Tests use mocks, no real secrets in repo.
- **No keychain integration yet** — env vars only. Future PR could add macOS keychain / Linux secret-service.

---

## What's deliberately out of scope (no plans)

- **Mexico CFDI, Colombia DIAN, etc** — Peru-only by design.
- **PDF render del CPE** — there are 50 libs for that. We return UBL XML; render somewhere else.
- **GUI / dashboard / web UI** — CLI + REST API only.
- **Reemplazar a un OSE acreditado** — for empresas obligadas a OSE (>75 UIT/año en CPE B2B), the CLI should be able to USE one as driver (`--driver nubefact`), not replace one. Acreditarse cuesta meses de trámite SUNAT.
- **"Auto-anular" en caso de error** — anular es siempre T3 manual con intent token. No automation.
- **Cumplimiento garantizado** — disclaimer in SKILL.md and `--help`. SUNAT compliance is the empresa emisora's responsibility.

---

## How to update this doc

When opening a PR:

1. Add new limitations to the relevant section (or create one)
2. Move items from "shaped/blocked" to "verified" when you confirm them live
3. Update the verification timestamp on the verified items
4. Link from PR description: "see LIMITATIONS.md for what's NOT in this PR"

Don't let this doc rot. If a PR adds capability without updating LIMITATIONS, that's a review blocker.
