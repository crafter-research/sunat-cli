# SUNAT CLI Schemas

## RHE Emit Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| empresa | string(100) | yes | - | Company/person name receiving the service |
| tipoDoc | enum | no | SIN DOCUMENTO | Only SIN DOCUMENTO is verified. RUC/DNI require an uncaptured validation transition. |
| descripcion | string(200) | yes | - | Service description |
| monto | number | yes | - | Total amount (0.01-1000000). The captured flow used PEN; preview USD before live use. |
| moneda | enum | no | PEN | PEN or USD |
| medioPago | enum | no | TRANSFERENCIA | DEPOSITO, GIRO, TRANSFERENCIA, ORDEN DE PAGO, TARJETA DEBITO, TARJETA CREDITO, CHEQUE, EFECTIVO |
| fechaEmision | date | no | today | YYYY-MM-DD. Written as DD/MM/YYYY. The observed portal accepts today or the previous 2 days. |

Portal: SOL viejo (e-menu.sunat.gob.pe/cl-ti-itmenu/) -- no captcha.

`--dry-run` validates locally. `--preview-only` sends the stateful form endpoint
through the server draft, renders it in the iframe and stops at the reconciled
`Emitir Recibo` page. Submission requires `--yes --live-sunat`.

## F616 Declare Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| periodo | string | yes | - | YYYY-MM tax period |

SUNAT prefills income and withholdings from registered RHE. The CLI does not write either value.

Portal: Nueva Plataforma (e-menu.sunat.gob.pe/cl-ti-itmenu2/) -- requires reCAPTCHA v2 one-time.

## Example RHE payload

```json
{
  "empresa": "Cliente Ejemplo",
  "tipoDoc": "SIN DOCUMENTO",
  "descripcion": "Servicios de desarrollo de software - {MES} {AÑO}",
  "monto": 6700,
  "moneda": "USD",
  "medioPago": "TRANSFERENCIA"
}
```

## Example F616 payload

```json
{
  "periodo": "2026-03"
}
```

## CSV Batch Format (RHE)

```csv
empresa,tipoDoc,descripcion,monto,moneda,medioPago,fechaEmision
"Cliente Ejemplo","SIN DOCUMENTO","Desarrollo software - Enero 2026",6700,USD,TRANSFERENCIA,2026-01-31
"Cliente Ejemplo","SIN DOCUMENTO","Desarrollo software - Febrero 2026",6700,USD,TRANSFERENCIA,2026-02-28
```
