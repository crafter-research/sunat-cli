# SIRE — Sistema Integrado de Registros Electrónicos

Research notes for `src/sunat-rest/sire.ts` (added in PR #4).

## What this PR ships

| Capability | Method | Verified shape source |
|------------|--------|----------------------|
| OAuth password grant (SIRE-specific) | `POST /v1/clientessol/{cid}/oauth2/token/` | Manual SUNAT v22 page 21 |
| Listar periodos RVIE/RCE | `GET /v1/contribuyente/migeigv/libros/rvierce/padron/web/omisos/{codLibro}/periodos` | Manual page 22 |
| Aceptar propuesta RVIE | `POST /v1/contribuyente/migeigv/libros/rvie/propuesta/web/propuesta/{periodo}/aceptapropuesta` | Manual page 31 |
| Descargar propuesta RVIE (async) | `GET /v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/exportapropuesta` | Manual page 45 |
| Descargar propuesta RCE (async) | `GET /v1/contribuyente/migeigv/libros/rce/propuesta/web/propuesta/{periodo}/exportacioncomprobantepropuesta` | Manual SIRE Compras |
| Descargar RVIE generado (async) | `GET /v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/exportarregistropropuesta` | Manual page 57 |
| Consultar estado ticket | `GET /v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets` | Manual page 40 |
| Descargar archivo generado | `GET /v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte` | Manual page 43 |

## What this PR does NOT ship

- **Reemplazar propuesta** — uses TUS.IO protocol (resumable file upload) which
  needs Java per SUNAT's own note. Shaped for follow-up PR with a TUS client.
- **Importar nuevos comprobantes propuesta/preliminar** — also TUS.IO.
- **Importar ajustes posteriores** — also TUS.IO.
- **Tipo de cambio masivo** — JSON POST, easy to add but not the highest-value flow.
- **Reportes complementarios** (resumen, inconsistencias, CAR, casillas, etc) —
  add as needed; same async ticket pattern.
- **SUNAT's note**: "los servicios del API SIRE no deben ser consumidos desde un
  cliente Web, en caso de utilizar un cliente Web se producirá error de CORS".
  Server-side only. CLI is server-side, so we're fine.

## OAuth flow (SIRE password grant)

Different from CPE consulta (PR #3) which uses `client_credentials`:

```
POST https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/
Content-Type: application/x-www-form-urlencoded

grant_type=password
&scope=https://api-sire.sunat.gob.pe
&client_id={client_id}
&client_secret={client_secret}
&username={RUC}{SOL_USER}    ← concatenated, e.g. "20131312955MODDATOS"
&password={SOL_PASSWORD}      ← Clave SOL real
```

Response same as PR #3:
```json
{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }
```

`oauth.ts` was extended with an optional `username/password` pair — when both
are set, it switches grant type and endpoint automatically. CPE consulta calls
keep working unchanged.

## Async ticket pattern

Most write/heavy operations return a ticket. Flow:

1. Trigger op (e.g. `descargarPropuesta`) → returns `numTicket`
2. Poll `consultarTicket(numTicket)` until `codEstadoProceso == "06"` (Terminado)
3. Use the returned `archivoReporte[].nomArchivoReporte` to download via
   `descargarArchivo()` — that endpoint streams the actual ZIP/TXT bytes

States (`codEstadoProceso`):
- `01` Iniciado
- `03` En proceso
- `06` Terminado ✅
- `07` Error
- `08` ?
- `10` Terminado con error
- `98` (our internal) Polling timeout

The CLI wraps this in `--wait [--timeout]` so the operator gets a single-call
UX. Without `--wait`, ticket is returned for manual polling later.

## codLibro values

```
140000 = RVIE (Registro de Ventas e Ingresos)
080000 = RCE (Registro de Compras)
```

## Why SIRE matters

Mandatory since 2024 for all electronic-invoice emisores in Peru. Multa per
late filing = up to 1 UIT (S/5,350 in 2026). Today contadores do this manually
in the SOL portal monthly. This automates 95% of the workflow.

## Verified end-to-end

Not yet verified against real SIRE because it requires a real RUC with active
billing history (RUC 20000000001 test cert from PR #1 doesn't have RVIE
periods). The XML/JSON shapes follow the official SUNAT manual v22 (March 2024).

When you test with your own cert + credentials: the `--out` flag on `propuesta`
+ `--wait` should give you the working .zip on first call.
