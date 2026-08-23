# SUNAT CLI Schemas

## RHE Emit Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| empresa | string(100) | yes | - | Company/person name receiving the service |
| tipoDoc | enum | no | SIN DOCUMENTO | SIN DOCUMENTO, RUC, DNI, CARNET DE EXTRANJERIA, PASAPORTE, CED. DIPLOMATICA DE IDENTIDAD |
| descripcion | string(200) | yes | - | Service description |
| monto | number | yes | - | Total amount (0.01-1000000). USD auto-converts to PEN |
| moneda | enum | no | PEN | PEN or USD |
| medioPago | enum | no | TRANSFERENCIA | DEPOSITO, GIRO, TRANSFERENCIA, ORDEN DE PAGO, TARJETA DEBITO, TARJETA CREDITO, CHEQUE, EFECTIVO |
| fechaEmision | date | no | today | The portal refuses anything older than 2 days. **Accepted by the CLI but never written to the form**, and returned in the result as if it had been |

Portal: SOL viejo (e-menu.sunat.gob.pe/cl-ti-itmenu/) -- no captcha.

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

## Hunter's Typical RHE Payload (Clerk)

```json
{
  "empresa": "Clerk Inc",
  "tipoDoc": "SIN DOCUMENTO",
  "descripcion": "Servicios de desarrollo de software - {MES} {AÑO}",
  "monto": 6700,
  "moneda": "USD",
  "medioPago": "TRANSFERENCIA"
}
```

## Hunter's Typical F616 Flow

There is no payload: the amount comes from a row loaded into the form.

```bash
sunat f616 declarar periodo 2026-03
sunat f616 declarar ingreso --fecha 03/03/2026 --monto 21016 --cliente "CLERK INC"
sunat f616 declarar estado     # casilla 355 has the figure SUNAT will charge
sunat f616 declarar bandeja
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
"Clerk Inc","SIN DOCUMENTO","Desarrollo software - Enero 2026",6700,USD,TRANSFERENCIA,2026-01-31
"Clerk Inc","SIN DOCUMENTO","Desarrollo software - Febrero 2026",6700,USD,TRANSFERENCIA,2026-02-28
```
