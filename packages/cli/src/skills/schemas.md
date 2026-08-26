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
| telefono | string | no | - | Información General requires it before the other tabs unlock |
| profesion | string | no | INGENIERO | From SUNAT's catalog (`f616 oficios`) |
| ingresoPEN | number | no | - | **Declared in the schema, ignored by the code.** SUNAT computes from the registered rows |
| retenciones | number | no | - | Same: ignored |

**The amount is not an input.** Casilla 307 is readonly and sums the rows in the
income table, so the figure comes from what is loaded there, not from a payload.

Interest (casilla 553) is read from the form. TIM at 0.9%/month from the due date
does not reproduce SUNAT's number: for 11/2025 it charges S/53 where the formula
gives S/124.

Portal: Nueva Plataforma (e-menu.sunat.gob.pe/cl-ti-itmenu2/), menu code 55.1.3.1.5.

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

## Example F616 flow

There is no payload: the amount comes from a row loaded into the form.

```bash
sunat-cli f616 declarar periodo 2026-03
sunat-cli f616 declarar ingreso --fecha 03/03/2026 --monto 21016 --cliente "CLIENTE EJEMPLO"
sunat-cli f616 declarar estado     # casilla 355 has the figure SUNAT will charge
sunat-cli f616 declarar bandeja
```

Income row fields (the modal's, not a CLI schema):

| Field | Format | Required |
|---|---|---|
| Tipo de documento | RUC / DNI / OTROS | yes |
| Serie | 4 digits, **no letter** (`0001`, not `E001`) | yes, despite no asterisk |
| Número | 8 chars | yes, despite no asterisk |
| Fecha emisión | DD/MM/AAAA, month must match the period | yes |
| Fecha pago | DD/MM/AAAA | yes, despite no asterisk |
| Monto | soles | yes |

## CSV Batch Format (RHE)

```csv
empresa,tipoDoc,descripcion,monto,moneda,medioPago,fechaEmision
"Cliente Ejemplo","SIN DOCUMENTO","Desarrollo software - Enero 2026",6700,USD,TRANSFERENCIA,2026-01-31
"Cliente Ejemplo","SIN DOCUMENTO","Desarrollo software - Febrero 2026",6700,USD,TRANSFERENCIA,2026-02-28
```
