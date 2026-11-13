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
| `sunat-direct` | 🔬 | 🔬 (≥S/700 individual) | 🔬 | ⚠️ via REST `cpe gre` (PR #7) | ⚠️ XML verified, send blocked by WAF on test RUC | ⚠️ XML verified, untested live |
| `facturador` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 |
| `nubefact` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 |
| `apisperu` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 |

### Active limitations

- **NC, ND** — ✅ shipped in PR #9 as `sunat cpe nc emit` and `sunat cpe nd emit` (sunat-direct driver). UBL builders for `CreditNote-2` / `DebitNote-2` schemas, full validation against Catálogo 09 (NC) and Catálogo 10 (ND), reuses XAdES signer + SOAP `sendBill` from PR #1. **Verified end-to-end against SUNAT beta 2026-04-29** (FC01-555 and FD01-777 both `cdrCode=0` Aceptado).
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
- **Producción (`e-factura.sunat.gob.pe`)** — never tested. All verifications were against `e-beta.sunat.gob.pe`. Switching `--mode prod` should work but **never run prod without dry-run + careful first emission**.
  - Measured 2026-08-09: prod answers a rejected SOAP request with **HTTP 200 and an empty body**, where beta returns a real envelope (`statusCode 0127`). The prod WSDL is served normally and its `soap:address` matches the endpoint the driver uses, so an empty body means the request was refused (WSSE username is `RUC + SOL user`), not that the endpoint is wrong. `postSoap` now throws on an empty body; before that fix `getStatus` read it as `processing` and `pollStatus` span for 5 minutes before dying on a timeout.
- **F616 has a headless read path now (0.6.0).** The form is a jQuery SPA over a JSON API at `e-plataformaunica.sunat.gob.pe`. Its `IdCache` auth header is a JWT SUNAT's own portal client mints during the browser login (aud `e-plataformaunica`, 3600s). A self-registered API client cannot get that audience, so the token is captured from the browser once and reused headless for its hour. Verified 2026-08-09: `sunat-cli f616 periodo` and `f616 oficios` return HTTP 200 with the browser fully closed. The form-driving `declareF616` path is still there but the API path skips the disabled-controls problem entirely for reads. Submission (`procesarPresentarPagar`) is not wired: its request body has not been captured.
- **F616 form is inert on entry, and `f616 declare` cannot file yet.** Verified against production 2026-08-09 with a live SOL session. Login, the SOL to Nueva Plataforma hop and navigation into the form all work; the form itself opens with every control disabled (`telefono`, `profesion`, `Siguiente`) and a `div.modal-backdrop` over it. The backdrop belongs to a "Sr. Contribuyente" notice whose button is labelled `Close`, not `Aceptar`, so the existing dismissal never matched it; that is fixed, and dismissing it does clear the backdrop, but the controls stay disabled. Writing the periodo through CDP sets the value without waking the form. Unresolved: what the portal requires before it enables the fields. Note also that `declareF616` walks to "Determinación de la Deuda" and returns, so it never submits a declaration even without `--dry-run`.
- **F616 does not set the income.** `schema f616` advertised `ingresoPEN` as required and `pagoACuenta = ingresoPEN * 0.08 - retenciones`, but neither field is read anywhere in the code: `declareF616` only writes `casilla007` (the periodo), plus telefono and profesion. The amount comes from whatever SUNAT prefills from your registered RHE. Corrected in the schema 2026-08-09. Verify the prefilled figure in the portal before submitting, since passing a number here changes nothing.
- **SOL rejects clients without a browser User-Agent.** `e-menu.sunat.gob.pe` and `e-consulta.sunat.gob.pe` close the connection on curl's default UA (empty reply, no status line), and answer 200 with a normal Chrome UA. Verified 2026-08-09 from Argentina and, through a Peruvian exit IP, from Peru: same failure and same fix in both, so this is UA filtering and **not** geo-blocking. Anything raw-HTTP against those hosts must send a browser UA; agent-browser already does.

### Verified end-to-end against SUNAT beta (2026-04-29)

- ✅ `cpe factura emit --driver sunat-direct` → `cdrCode=0` Aceptado
- ✅ `cpe boleta emit --driver sunat-direct` (≥S/700) → `cdrCode=0` Aceptado
- ✅ `cpe nc emit --driver sunat-direct` → `cdrCode=0` Aceptado (FC01-555, PR #9)
- ✅ `cpe nd emit --driver sunat-direct` → `cdrCode=0` Aceptado (FD01-777, PR #9)
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

## Buzón SOL metadata

Read-only metadata namespace over the legacy visor on `ww1.sunat.gob.pe`.

- `buzon list` is verified live against an own production account for folders, alerts, messages and notifications.
- `buzon status` is offline and reads a private `0600` snapshot under `SUNAT_HOME`.
- The visor tries to open detail automatically. The CLI blocks `/obtenerDetalleNotiMen` before navigation, so the request cannot reach SUNAT.
- SUNAT has returned contradictory `total`, `records` and row counts. The CLI exposes all observations and never treats a reported total as authoritative.
- Message bodies, attachments, triage, autonomous polling and multi-RUC operation are deliberately absent.
- `fecVigencia` is preserved only as `validUntilObserved`. It is not interpreted as a legal deadline.
- CI uses redacted fixtures. Live portal behavior still needs post-release dogfood because no credentials are available in GitHub Actions.

## Declaraciones presentadas y constancias

Read-only namespace over SOL's legacy "Consulta de declaraciones juradas y pagos" servlet on `ww1.sunat.gob.pe/cl-ti-itdeclpagcon-mepeco/cdpS01Alias` (menu code `12.1.1.1.4`).

- 🔬 `declaraciones list` and `declaraciones constancia` verified live 2026-08-27 against a production RUC 20: the listing returned 0601, 0621 and 1663 rows for Jun–Aug 2026 and the constancia PDFs of a 0601 and a 0621 filing were downloaded (~45 KB each, `%PDF-`, text extractable). Also exercised through the Node build with `bun smoke:declaraciones`.
- ⚠️ **The servlet must be entered through the SOL menu.** Its session cookie is minted by the `action=execute&code=12.1.1.1.4&s=ww1` hop; opening the servlet URL cold answers 200 with the login page and every later fetch returns an empty table. The CLI always clicks the menu leaf first.
- ⚠️ **Six-month window.** The visor rejects wider ranges (`diferenciaMayor6meses`); the CLI validates before calling.
- 🚧 **Only the first page of results is read.** The visor paginates via `ConsultaDeclaracion.jsp` (`tamanioPagina`, `pagina`); a small taxpayer never reaches page two, so pagination is not implemented yet.
- 🚧 **0709/0710 constancias are not downloaded.** Annual returns are listed, but their PDF goes through `generarConstanciaNPlat` → `accion=obtener_reportPdf&num_pres&cod_for&num_ord`, a different path that was not exercised. `renta constancia` covers the 0709 case.
- 🚧 **Boleta 1663 detail is not read.** `accion=ComprobanteCons` returned an empty body when replayed with `fetch`; the visor submits it as a full-page form. Payment rows are listed with `numOrden` and `numPresentacion` only.
- ⚠️ SUNAT's `validar_constanciaNP` answers `<codigo>0</codigo>` while the PDF is still being rendered ("aun no se encuentra disponible"). The CLI surfaces this as `not-available`; retry later.
- The server-side `cod_for` / `num_ord` filters of the form are sent empty; filtering is client-side because their behavior was not measured.

## Renta Anual F709 — e-renta (PR: read path)

Read-only namespace over `e-renta.sunat.gob.pe`. Recon: `recon/sunat-f709-erenta-api.md`.

### Verified end-to-end 2026-08-21

- 🔬 `renta login` — OAuth via SUNAT's e-renta client, token cached to `~/.sunat/renta-token.json` (0600)
- 🔬 `renta whoami`, `renta status` — session state and server date
- 🔬 `renta form -e 2025` — form metadata, filing window, official help links
- 🔬 `renta casillas -e 2025` — 88 casillas with required/editable flags
- 🔬 `renta declaracion -e 2025` — the prefilled declaration (62KB document)
- 🔬 `renta presentaciones -e 2024` — filing history, returned 2 real filings
- 🔬 `renta constancia <id>` — proof of filing for a real past declaration

All of the above were exercised through the globally linked binary against
production SUNAT, with the browser closed after login. Control: the same
requests without the bearer token return HTTP 401, so the token is what
authorizes rather than a residual browser session.

### Deliberately not implemented

- 🚧 **Filing, amending and paying.** `orquestacionpresentacion/procesarPresentarPagar`
  is identified in the SPA bundle but is NOT wired and must not be until its
  request body is captured from a real filing. Filing an annual return is
  irreversible. `predeclaracion/save` (draft write) is in the same position.
- 🚧 PDF export (`generador/ppnn/*`) and the payment gateway (`orquestacionproxypago/*`)
  are mapped in `recon/f709-uri-table.txt` but not implemented.

### Active limitations

- ⚠️ **Seasonal.** The filing window for ejercicio 2025 opened 31 March 2026 and
  closed in June 2026 by RUC last digit. Reads work year-round; a filing flow
  could not be tested end-to-end outside the window even if it were built.
- ⚠️ **Only ejercicio 2025 and 2024 were exercised.** The selector offers 2019
  onward and the schema endpoint is per-ejercicio, so older years likely work,
  but they are untested.
- ⚠️ **`version-web` is a client-version gate.** Captured at login from the live
  SPA (`SUNAT.Version`), with `v4.3.12` as a fallback constant. When SUNAT bumps
  it, a stale cached token returns HTTP 422 code 42209; re-running `renta login`
  picks up the new value. The CLI surfaces that error verbatim rather than retrying.
- ⚠️ **SUNAT throttles by source IP.** ~15-20 requests within seconds makes every
  subsequent request return a static nginx 500 for 1-2 minutes, with no
  `Retry-After` header. The client serializes requests with a 1.2s floor;
  do not parallelise `renta` commands.
- ⚠️ **`consultadeclaracion/.../resumen` wants `formulario=709` without the
  leading zero** while every other endpoint wants `0709`. Measured by contrast.
  Do not "fix" it to match its neighbours.
- ⚠️ **An unknown identifier returns HTTP 202 with an empty body**, not a 404.
  Surfaced as error code `empty`.
- ⚠️ **Token acquisition still needs the browser.** SUNAT's e-renta client is
  registered for `authorization_code` only. Whether a self-registered API client
  can be granted the `e-renta` scope is the open question that would remove the
  browser entirely. Untested.

---

## RHE / F616 — Personas Naturales (legacy, pre-existing)

These surfaces still need browser bootstrap, but RHE no longer fills identity and detail fields through DOM automation:

- ⚠️ **Browser boundary** — RHE uses direct HTTP through preview, but Menu SOL bootstrap and the final legal confirmation still depend on the headed portal.
- ⚠️ **reCAPTCHA via mouse coordinates** — F616 (Nueva Plataforma) requires solving reCAPTCHA. Solved via coordinate injection. Documented as fragile in `CLAUDE.md`.
- ⚠️ **RHE emission**: direct deduction, identity and details POSTs were replayed with varied inputs and rendered back into the live draft preview for `CONTADO` + `SIN DOCUMENTO`. `GrabaReciboHonorarios` was not called during implementation, so a new production emission is still unverified. The confirmation HTML exposes `descargarreciboxml1` and `descargarrecibopdf1`; their POST bodies are implemented, but their real response headers and bytes remain unverified until the next intended issuance.
- ✅ **F616 declaration**: verified working against the SUNAT portal.

---

## Cross-cutting

### Testing gaps

- **Production submissions** never tested. Always use `--mode beta` (or its equivalent) until you've manually verified one production emission.
- **Stress / rate-limit tests** never run. SUNAT WAF behavior under load is unknown.
- **Live Multi-RUC SUNAT submissions** — profile switching is covered by local E2E tests, but real SUNAT beta/prod runs across multiple RUCs still need manual QA.
- **Cert expiry** — `cpe doctor` warns at <30 days. Never tested with an actually-expired cert.

### Environment

- **Java not bundled** — driver `facturador` (when implemented) will assume Java 8u202+ already running in a sibling container. Not auto-installed.
- **Bun-only** — code uses Bun-native APIs (`Bun.spawn`, `crypto.subtle`, native fetch). Won't run on plain Node without porting.
- **macOS / Linux only** — Windows untested. Path handling uses `~/.sunat/` style; tests use `tmpdir()`. Should work on Windows in theory but no CI for it.

### Audit / observability

- **Audit log under `~/.sunat/audit/`:** compacted into owner-only monthly archives after six months. Use `sunat-cli audit prune` for an explicit retention policy.
- **No remote telemetry** — by design. Everything stays on disk.
- **`cpe doctor` stale-pending check** — alerts when audit has `pending` entries >1h old. Cleanup is manual (user decides whether to retry, void, or just delete).

### Security

- **Cert PFX password:** read from `CPE_CERT_PASSWORD` or the OS keychain. Never written to config, audit, or another plaintext file. Never logged.
- **SOL password:** read from `CPE_SOL_PASSWORD` / `SUNAT_PASSWORD` or the OS keychain. Never written to config, audit, or another plaintext file. Never logged.
- **API client_secret:** read from the environment or OS keychain. Never written to config, audit, or another plaintext file. Tests use mocks, no real secrets in the repo.
- **OS keychain integration:** available on macOS Keychain and Linux Secret Service. Environment variables remain supported for ephemeral automation.

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
