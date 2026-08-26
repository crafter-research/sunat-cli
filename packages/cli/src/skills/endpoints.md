# SUNAT endpoints behind the CLI

Measured against the portal, not from documentation. SUNAT publishes none of this.

## The split that matters

| Surface | Nature | How the CLI talks to it |
|---|---|---|
| Nueva Plataforma (`e-plataformaunica`) | JSON API | `fetch` with an `IdCache` header |
| SOL viejo (`ol-ti-*`, `cl-ti-*`) | server-rendered | browser, no way around it |

The old modules take an `hc` (hash) and a `token` (base64) in the entry URL, both
minted by the menu's redirect. **They cannot be forged** — you have to navigate.

## Nueva Plataforma: F616

Base: `https://e-plataformaunica.sunat.gob.pe`
Path: `/v1/recaudacion/tributaria/declaracion/pagoelectronico/trabajadorindependiente`

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `{base}/e/obtenerPeriodo/{MMYYYY}` | opens a period; returns comprobante types, TIM table, due date | observed 200 |
| GET | `{base}/e/obtenerListaOficios` | profession catalog | observed 200 |
| GET | `{base}/e/obtenerDatosEmpresa/{RUC}` | company lookup | observed 200 |
| GET | `{base}/e/obtenerDatosPersona/{DNI}` | person lookup | from source |
| GET | `{base}/e/comprobarExistenciaRecibo/{tipo}/{serie}/{numero}` | RHE existence check | from source |
| GET | `{base}/t/consulta/obtenerSaldoAFavorPeriodoAnterior/{MMYYYY}` | prior credit | 404 on this account |

`periodo` is `MMYYYY` with no separator: `112025` for November 2025.

Auth: two headers on top of the session cookies.

```
IdCache: <JWT>
IdFormulario: *MENU*
```

The JWT arrives as the `idCache` query parameter on the navigation URL, lives one
hour, and cannot be minted headless: the portal's own client is registered for
`authorization_code` only and its secret belongs to SUNAT.

## Presentation and payment

```
POST /v1/recaudacion/tributaria/parametriapasarela/t/consulta/obtenerParametriaPasarela/
POST /v1/recaudacion/tributaria/orquestacionpresentacion/t/consulta/validarPresentacion
POST /v1/recaudacion/tributaria/orquestacionpresentacion/t/consulta/procesarPresentarPagar
POST /v1/recaudacion/tributaria/orquestacionproxypago/e/registro/realizarPago
```

`obtenerParametriaPasarela` carries the whole tray:

```json
{"numPas":1,"numAplPas":"001","formularios":[
  {"codigoFormulario":"0616","tributos":[{"codigoTributo":"030401","descTributo":"1812"}]}
]}
```

**`procesarPresentarPagar` has never been captured.** Its body is unknown. Payment
runs through Niubiz/Visanet on a different domain.

## Tipo de cambio

```
POST https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias/listarTipoCambio
body: {"anio": 2025, "mes": 10, "token": "x"}
-> [{"fecPublica":"01/11/2025","valTipo":"3.372","codTipo":"C"}, ...]
```

Three traps:
- **`mes` is zero-indexed** (JS `getMonth()`): `mes=10` returns November.
- **An empty `token` returns HTTP 200 with `[]`**, indistinguishable from no data.
  Send any non-empty string; the contents are not validated.
- The WAF rejects requests without browser-like headers. A User-Agent swap is not
  enough: `Referer` and `Origin` are required.

SUNAT publishes a rate for every calendar day, weekends included.

## SOL viejo: menu codes

| Code | Module |
|---|---|
| `11.5.1.1.2` | Emisión de RHE |
| `11.5.1.1.13` | Consulta de RHE |
| `55.1.3.1.5` | F616 (Nueva Plataforma) |
| `10.11.1.1.1` | Reporte Tributario para Terceros |
| `15.1.1.1.1` | Consulta de Valores Pendientes de Pago |
| `12.1.1.1.4` | Consulta de Declaraciones Juradas y Pagos |

### RHE emission

Menu SOL action `11.5.1.1.2` mints a fresh entry URL. A direct GET of that URL
needs no imported browser cookies and creates the RHE form session. Every later
stage posts to `/ol-ti-itreciboelectronico/cpelec001Alias`:

| Stage | `accion` |
|---|---|
| Deduction | `RHEDeduccion1` |
| Identity | `CapturaDatosReciboHonorariosIdentidad` |
| Details and server preview | `CapturaDatosReciboHonorarios` |
| Production submission | `GrabaReciboHonorarios` |
| Issued XML | `descargarreciboxml1` |
| Issued PDF | `descargarrecibopdf1` |

The entry URL carries six required query fields: `accion`, `p`, `tenc`, `prg`,
`fecenv` and `usub`. Treat the whole URL as a secret. Direct HTTP is verified
through preview for `CONTADO` + `SIN DOCUMENTO`; the final submission remains a
browser confirmation. The confirmation HTML contains two same-endpoint POST
forms with only the XML and PDF actions above. The original HAR did not capture
their responses, so the CLI validates the returned XML structure and PDF
signature before saving them. The raw HAR is private and excluded from the
repository.

### Reporte Tributario para Terceros

`/ol-ti-itreportetri/reportetri.htm` → tick `#chkAceptar`, then `#btnAceptar`,
then `?action=cargarFormulario`.

`txtCorreo` is editable, so the destination can be chosen. But the form carries a
`tokenCaptchaV3` and a Cloudflare Turnstile widget, and **both stay empty under
CDP** — Cloudflare answers "Verification failed" even when a human solves it,
because the browser runs with debugging flags. This one cannot be finished
headless. Limit: 3 reports a day.

### Valores Pendientes de Pago

`/cl-ti-itvalores-consulta/adeudos/inicio` — fields `txtStartDate`, `txtEndDate`,
`txtNumValor`, `btnConsultar`.

Period format is `MMAAAA`, **6 characters, no slash**, and **the range cannot
exceed 6 months**. There is no general "constancia de no adeudo" for internal
taxes; this listing is the closest thing, and it exports to a file.

## Buzón SOL metadata

Base: `https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor`

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/ajax/listarCarpetas` | folder metadata | observed 200 |
| POST | `/consultarAlertas` | alert metadata | observed 200 |
| GET | `/listNotiMenPag` | paginated messages and notifications | observed 200 |
| GET | `/obtenerDetalleNotiMen` | body and attachments | blocked, not called by the CLI |

`tipoMsj=1` selects messages and `tipoMsj=2` selects notifications. Pagination
also sends `codCarpeta=00`, `page`, `tipoOrden=NADA`, and empty filters.

The visor requests detail automatically when it loads. `buzon list` installs a
browser route before entering the visor, so that request is blocked locally and
cannot update read state at SUNAT. The CLI then fetches only metadata inside the
authenticated cross-origin frame.

The response fields `total`, `records` and `rows.length` are not equivalent and
have contradicted each other live. The CLI preserves them separately.

## Login

```
GET e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*
GET api-seguridad.sunat.gob.pe/v1/clientessol/4f3b88b3-.../oauth2/authen
GET api-seguridad.sunat.gob.pe/v1/clientessol/4f3b88b3-.../oauth2/loginMenuSol
```

The SOL menu's `clientId` (`4f3b88b3-...`) differs from the Nueva Plataforma's
(`59d39217-...`). Entering the Nueva Plataforma directly can fail with "Error en
la invocación": it has to be reached through SOL so a valid OAuth `state` exists.

Everything here was measured against the live portal between 2026-08-09 and
2026-08-23. SUNAT documents none of it, so treat it as observation that can go
stale rather than as a contract.
