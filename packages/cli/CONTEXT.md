# sunat-cli Agent Context

## The agent is not a trusted operator

This CLI automates SUNAT (Peru's tax authority) operations. Mistakes have financial consequences. Always --dry-run before mutating.

## Architecture

- **Browser automation**: agent-browser (v0.22.2) controls Chrome via CDP
- **Always headed mode**: SUNAT blocks headless Chrome (`ERR_CONNECTION_RESET`)
- **SOL viejo** (no CAPTCHA): Used for RHE emission
- **Nueva Plataforma** (no CAPTCHA via SOL bypass): Used for F616 declaration
- **REST API** (OAuth2): Used for verification only — RHE emission has no API
- **Raw CDP WebSocket**: Used for cross-origin iframe input (F616 periodo field)

## Auth flow

1. `sunat login` → SOL viejo (headed, no CAPTCHA, fully automated)
2. For F616: navigate from SOL to `itmenu2/MenuInternetPlataforma.htm?exe=55.1.1.1.1` → second login (same creds, NO reCAPTCHA because proper OAuth `state` is generated)
3. For API: `sunat api token` → OAuth2 JWT via `api-seguridad.sunat.gob.pe` (no browser needed)

## Critical gotchas

- SUNAT blocks headless Chrome — always use `--headed` (handled by client.ts)
- SUNAT forms have `beforeunload` guards — clear with `window.onbeforeunload = null`
- Refs (@e1, @e2) change on every page load — find by text/type, never hardcode
- SOL sessions expire after ~20 minutes — re-authenticate automatically
- RHE dates: SUNAT allows max 2-3 days retroactive. For regularizacion, all get today's date
- F616 auto-populates from RHE data — emit RHEs BEFORE declaring F616
- F616 periodo field (`casilla007`) has an input mask that rejects all normal input — use `setInputValueInIframe()` from `src/browser/cdp.ts` which bypasses via raw CDP
- SOL menu navigation uses `ejecuta()` JS function, not clickable links
- Nueva Plataforma form content loads in cross-origin iframe (`e-plataformaunica.sunat.gob.pe`) — agent-browser reads refs but keyboard events go to wrong frame

## Input safety

All inputs are validated in `src/validation/input.ts`:
- RUC: exactly 11 digits, starts with 10 or 20
- Amounts: positive, max 2 decimals, max 1M
- Empresas: max 100 chars, no URL encoding, no control chars
- Paths: no traversals, no tilde
- Periodos: YYYY-MM format, valid range

## Output format

- `--output json`: Always available, NDJSON for arrays
- `--output table`: Human-readable, default when TTY
- `--output auto`: json when piped, table when interactive

## Key files

- `src/browser/client.ts` — agent-browser typed wrapper (always headed)
- `src/browser/cdp.ts` — raw CDP WebSocket for cross-origin iframe input
- `src/browser/auth.ts` — SOL + Nueva Plataforma login flows
- `src/browser/captcha.ts` — reCAPTCHA auto-solve via mouse coordinates
- `src/workflows/rhe.ts` — RHE 3-step form automation
- `src/validation/input.ts` — input hardening
- `data/example.csv` — example batch data (template)
- `data/regularizacion.csv` — real batch data (gitignored, private)
- `RESEARCH.md` — comprehensive portal research for future agents
