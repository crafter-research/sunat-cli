# SUNAT REST APIs — Research notes

This module covers the modern OAuth 2.0 REST APIs SUNAT exposes (separate
from the SOAP CPE emission flow under `src/cpe/`).

## What this PR ships

| Capability | Method | Auth | Endpoint / source |
|------------|--------|------|------------------|
| Consulta Integrada CPE | REST | OAuth 2.0 client_credentials | `POST api.sunat.gob.pe/v1/contribuyente/contribuyentes/{ruc}/validarcomprobante` |
| Padrón Reducido del RUC | Local file | None | Daily ZIP at `www2.sunat.gob.pe/padron_reducido_ruc.zip` |

## What this PR deliberately does NOT ship

- **Tipo de cambio**. Both `e-consulta.sunat.gob.pe/cl-at-ittipcam` and
  `sbs.gob.pe` are blocked by their WAF for direct curl/fetch (return
  "Request Rejected"). Needs `agent-browser` automation. Deferred to
  future PR with `--driver agent-browser` pattern (same as RHE/F616).
- **Padrón RUC consulta puntual via portal** (`e-consultaruc.sunat.gob.pe`).
  Now requires a `numRnd` token + reCAPTCHA. Same agent-browser path. The
  local padrón download is a strictly better answer for batch/scriptable
  use anyway.
- **GRE (Guía de Remisión Electrónica)** REST API. Separate scope, separate
  PR. Same OAuth shape so the `oauth.ts` module here is reusable.
- **SIRE (RVIE/RCE)** REST API. Higher-value next PR (mandatory monthly
  filing for all emisores). Distinct host `api-sire.sunat.gob.pe`.

## OAuth 2.0 flow (verified shape)

Token endpoint:
```
POST https://api-seguridad.sunat.gob.pe/v1/clientesextranet/{client_id}/oauth2/token/
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=https://api.sunat.gob.pe/v1/contribuyente/contribuyentes&client_id=...&client_secret=...
```

Response:
```json
{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }
```

Token lifetime: 1 hour. Cached in-process; auto-refreshed on 401.

Credentials are obtained from SOL menu:
**Mi RUC y Otros Registros → Apps Móviles → Credenciales API**.
This is distinct from the SOL user/password used by sunat-direct (SOAP).

## Consulta Integrada CPE — request shape

```
POST /v1/contribuyente/contribuyentes/{rucConsultante}/validarcomprobante
Authorization: Bearer {token}
Content-Type: application/json

{
  "numRuc": "20131312955",        // RUC del emisor del CPE
  "codComp": "01",                 // 01=Factura, 03=Boleta, 07=NC, 08=ND, ...
  "numeroSerie": "F001",
  "numero": "1234",
  "fechaEmision": "29/04/2026",   // DD/MM/YYYY (we convert from ISO automatically)
  "monto": "118.00"                // optional; if provided MUST match exactly
}
```

Response:
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "estadoCp": "0001",   // 0001=Aceptado, 0002=Anulado, 0003=Autorizada, 0004=No Autorizada
    "estadoRuc": "00",     // 00=Activo, 01/02=Baja Provisional, 10/11=Baja Definitiva, ...
    "condDomiRuc": "00",   // 00=Habido, 09=Pendiente, 12=No Hallado, 20=No Habido
    "observaciones": []
  }
}
```

We normalize codes to friendly descriptions in `consulta-cpe.ts`.

## Padrón Reducido del RUC

**Source**: `http://www2.sunat.gob.pe/padron_reducido_ruc.zip` (~370MB).
**Updated**: daily by SUNAT (Last-Modified header).
**Format**: single TXT inside the ZIP, pipe-separated, ISO-8859-1 encoded.

Schema (column order, based on SUNAT public docs):
```
RUC|RAZON_SOCIAL|ESTADO|CONDICION|UBIGEO|TIPO_VIA|NOMBRE_VIA|COD_ZONA|TIPO_ZONA|NUMERO|INTERIOR|LOTE|MANZANA|KILOMETRO
```

Implementation choices:
- Stream raw bytes to disk (no encoding conversion in hot path) — first run
  was 12+ minutes on 1GB UTF-8 conversion before we switched to pipe.
- Streaming lookup scans the TXT (5-15s) for ad-hoc queries.
- Batch lookup scans once for any number of RUCs.
- Future: sqlite index for sub-ms lookups (shaped for next PR).

## Why local padrón vs portal scrape vs 3rd-party API

| Approach | Cost | Friction | Reliability |
|---------|------|---------|------------|
| **Local padrón ZIP** | 370MB disk | First sync ~30-60s, then instant | High — no captcha, no rate limit, official source |
| Portal scrape (`e-consultaruc.sunat.gob.pe`) | 0 | Requires `numRnd` token + maybe reCAPTCHA | Medium — needs agent-browser, breaks on UI changes |
| 3rd party API (apis.net.pe, decolecta) | Token, sometimes paid | One curl | Medium — depends on 3rd party uptime + ToS |

Chose local because it's the only auth-free, official, batch-friendly option.

## Catalog of friendly mappings (consulta-cpe)

`estadoCp`:
- `0001` Aceptado
- `0002` Anulado
- `0003` Autorizada
- `0004` No Autorizada

`estadoRuc`:
- `00` Activo
- `01` Baja Provisional
- `02` Baja Provisional por Oficio
- `03` Suspensión Temporal
- `10` Baja Definitiva
- `11` Baja de Oficio
- `22` Inhabilitado

`condDomiRuc`:
- `00` Habido
- `09` Pendiente
- `11` Por verificar
- `12` No Hallado
- `20` No Habido

These maps live in `consulta-cpe.ts` and the cli surfaces both raw + friendly
in the JSON response so agents can pivot on either.
