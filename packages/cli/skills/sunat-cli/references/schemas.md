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
| fechaEmision | date | no | today | YYYY-MM-DD. Max 2-3 days retroactive |

Portal: SOL viejo (e-menu.sunat.gob.pe/cl-ti-itmenu/) -- no captcha.

## F616 Declare Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| periodo | string | yes | - | YYYY-MM tax period |
| ingresoPEN | number | yes | - | Total monthly income in PEN |
| retenciones | number | no | 0 | 4ta categoria withholdings (usually 0 for foreign employers) |

Computed: `pagoACuenta = ingresoPEN * 0.08 - retenciones`

Portal: Nueva Plataforma (e-menu.sunat.gob.pe/cl-ti-itmenu2/) -- requires reCAPTCHA v2 one-time.

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

## Hunter's Typical F616 Payload

```json
{
  "periodo": "2026-03",
  "ingresoPEN": 25000,
  "retenciones": 0
}
```

Result: pagoACuenta = 25000 * 0.08 = S/2,000

## CSV Batch Format (RHE)

```csv
empresa,tipoDoc,descripcion,monto,moneda,medioPago,fechaEmision
"Clerk Inc","SIN DOCUMENTO","Desarrollo software - Enero 2026",6700,USD,TRANSFERENCIA,2026-01-31
"Clerk Inc","SIN DOCUMENTO","Desarrollo software - Febrero 2026",6700,USD,TRANSFERENCIA,2026-02-28
```
