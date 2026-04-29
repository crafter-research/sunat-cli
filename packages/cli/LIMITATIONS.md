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

- **NC, ND, Guía de Remisión** — driver methods throw "not yet implemented" errors. UBL builders shaped in `src/cpe/ubl/`, signer + SOAP infra reusable. Estimated 1 day each. **Future PR**.
- **`sunat cpe void` (T3)** — intent-token flow shaped, command stubbed. Voiding is currently done via Comunicación de Baja (`sunat cpe baja send`) for boletas or NC for facturas. **Future PR**.
- **Resumen Diario `sendSummary` against SUNAT beta** — XML structure 100% verified against Greenter twig template; unit tests cover all 14 structural assertions. **However**, the actual SUNAT beta nginx wrapper returns transient HTTP 401 on the `/sendSummary` path with the public test RUC `20000000001`. `sendBill` calls in the same window work fine. Hypothesis: rate-limit specific to the RC endpoint on the shared test RUC. **Production cert + RUC will not see this.** Documented in `src/commands/cpe/RESEARCH.md` appendix.
- **Drivers `facturador`, `nubefact`, `apisperu`** — `getDriver()` returns a clear "shaped but not implemented" error. The `facturador` driver requires coordination with Christian Pasquel's containerized Java Facturador. The other two are PSE/OSE adapters; useful when the user wants to keep their existing OSE while gaining the CLI UX.
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
- ⛔ **Padrón puntual via portal `e-consultaruc.sunat.gob.pe`** — the form now requires a `numRnd` token + reCAPTCHA. Plain HTTP POSTs return 404. Workaround would need `agent-browser` automation (same pattern as RHE/F616 already use). **Local padrón is strictly better for batch/scriptable use anyway** — instantaneous after sync, no network roundtrip per RUC.

### Tipo de Cambio

- ⛔ **SUNAT `e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias`** — blocked by WAF, returns "Request Rejected".
- ⛔ **SBS `sbs.gob.pe`** — also blocked by WAF.
- 🚧 **`sunat tipo-cambio` command** — not implemented. Future PR with `agent-browser` driver.

### Consulta CPE Integrada

- ⚠️ **`sunat cpe consulta`** — code matches Greenter's openapi spec. Not yet tested live because it requires `SUNAT_API_CLIENT_ID/SECRET` from a real RUC's SOL menu (the shared test RUC doesn't have these credentials). When you set those env vars, should work first call.

---

## SIRE — Registro de Ventas / Compras (PR #4)

### Verified shapes (untested live)

All endpoints follow Manual de Servicios Web Api SIRE Ventas v22 (March 2024) at the byte level. Unit tests cover URL paths, request methods, body shapes, and OAuth password grant flow.

### Active limitations

- ⚠️ **Never tested against real SIRE.** Same reason as Consulta CPE: needs real RUC with SIRE credentials + active billing periods. The Greenter test RUC `20000000001` has no RVIE history. When you run the first time with your own creds + a periodo with data, `propuesta --wait --out X.zip` should give you the working ZIP.
- 🚧 **`reemplazar propuesta` + `importar comprobantes` (propuesta/preliminar/ajustes)** — not implemented. These use **TUS.IO resumable upload protocol**. SUNAT's own manual notes "deben ser desarrollados en JAVA". Needs a TUS.IO client in TS. **Estimated next PR (#5)**.
- 🚧 **Reportes complementarios** (resumen, inconsistencias, CAR, casillas, reporte de exportadores, reporte de cumplimiento, reporte estadístico) — same async ticket pattern as `propuesta`. Easy adds when needed.
- 🚧 **Tipo de cambio masivo** — JSON POST endpoint, easy add.
- 🚧 **Eliminar comprobantes** (propuesta / preliminar / reemplazo) — same shape, low priority.
- ⚠️ **CORS warning from SUNAT** — "los servicios del API SIRE no deben ser consumidos desde un cliente Web". CLI is server-side, not affected. Don't try to call these from a browser bundle.

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
