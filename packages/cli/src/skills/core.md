# sunat-cli

SUNAT tax automation via `npx @crafter/sunat-cli` (or `sunat-cli` if globally installed).

Install: `npm install -g @crafter/sunat-cli`. Runs on Node, no Bun needed.

RHE, F616 and the portal scrapers drive a real browser through
[agent-browser](https://github.com/vercel-labs/agent-browser), which is a
separate binary rather than a bundled dependency:

```bash
npm install -g agent-browser      # all platforms
brew install agent-browser        # macOS
agent-browser install             # download Chrome, first time only
```

CPE, SIRE and GRE need a SUNAT certificate and a clave SOL instead. Everything
else works with neither.

**Run `sunat-cli doctor` first.** It reports what is present, what is missing,
and the command that fixes each gap. A command that needs agent-browser and
cannot find it fails naming the tool and how to install it, rather than
reporting that navigation failed.

Current beta posture: supervised RHE/F616 beta, not autonomous filing. Real SUNAT operations require `--yes --live-sunat`, should use `--preview-only` first, and must stop if preview values cannot be parsed or reconciled.

## Auth

Three ways to provide credentials (priority order):

1. **Non-secret flags**: `sunat-cli login --ruc 10XXXXXXXXX --user XXXXXXXX`
2. **Env vars**: `SUNAT_RUC`, `SUNAT_USER`, `SUNAT_PASSWORD`
3. **Interactive prompts**: just run `sunat-cli login` and it asks step by step

```bash
sunat-cli keychain set SUNAT_PASSWORD
sunat-cli login --ruc 10XXXXXXXXX --user MYUSER
sunat-cli login --nueva-plataforma --ruc 10XXXXXXXXX --user MYUSER
sunat-cli whoami
```

RUC and usuario are saved to `~/.sunat/config.json` after first login. Password is never stored in config or another plaintext file; optional persistence uses the OS keychain.
For non-interactive setup, pipe the secret with `sunat-cli keychain set SUNAT_PASSWORD --stdin`; it is still stored only in the OS keychain.

### RHE (Recibo por Honorarios)

```bash
# Emit single RHE
sunat-cli rhe emit --params '{
  "empresa": "Cliente Ejemplo",
  "tipoDoc": "SIN DOCUMENTO",
  "descripcion": "Servicios de desarrollo de software",
  "monto": 6700,
  "moneda": "USD",
  "medioPago": "TRANSFERENCIA"
}'

# Preview without submitting
sunat-cli rhe emit --params '...' --dry-run

# Batch from CSV
sunat-cli rhe emit --batch recibos.csv

# List issued RHEs
sunat-cli rhe list

# Verify registration
sunat-cli rhe verify --month 2026-03
```

**RHE fields**: `sunat-cli skills get schemas` for the full field specs.

Key rules:
- `tipoDoc`: Use `SIN DOCUMENTO` for foreign companies (no RUC/DNI)
- `moneda`: USD requires explicit `tipoCambio` in beta
- `fechaEmision`: the portal refuses anything older than 2 days. Measured, not
  documented by SUNAT: no published resolution sets that limit, but the form
  enforces it with an alert that closes on its own (invisible to snapshots; the
  visible symptom is that the form simply does not advance).
- `fechaEmision` **is accepted but never written to the form** by `rhe emit`, and
  still comes back in the result as if it had been. Check before trusting a batch.
- Auth: SOL viejo portal through headed browser automation. Captcha/session behavior can change, so keep it supervised.

### F616 (Monthly Tax Declaration)

Two paths, and they do different things.

**Reading (T0, headless):**

```bash
sunat-cli f616 periodo 2026-03      # opens a period through the API
sunat-cli f616 oficios              # profession catalog
```

`periodo` returns the comprobantes already registered, the due date (`fec_ven`),
the interest-rate table and the 8% rate. It is a plain HTTP call once the token
is cached.

**Filling the form (T2, needs a browser):**

```bash
sunat-cli f616 declarar estado
sunat-cli f616 declarar periodo 2025-11
sunat-cli f616 declarar ingreso --fecha 17/11/2025 --monto 21054 --cliente "CLIENTE EJEMPLO"
sunat-cli f616 declarar bandeja
sunat-cli f616 declarar constancias --dir ~/Downloads/constancias
```

This is what unlocks filing months that went by: **the F616 does not need the RHE
to exist**. Income rows are typed into the form's own modal, which validates
neither serie nor número against the SEE, and puts no limit on how far back the
dates go. The electronic RHE issuer caps emission at two days; declaring never
goes through it.

Requires the F616 open in the browser (menu → Trabajadores Independientes - 616).

Key rules, each one learned by hitting it:
- **Serie is four digits, no letter.** `E001` is rejected, `0001` works.
- **Serie, número and fecha de pago are required** despite carrying no asterisk.
- **The month of the emission/payment date must match the open period.**
- **Reload the form between periods.** Changing the period updates the value but
  does not rebuild the modal's validation rules, which stay bound to the old one.
- With tipo de documento OTROS the razón social is locked, so a company name gets
  split across the surname fields. The record is still valid.
- **Interest is read from casilla 553, never computed.** TIM at 0.9%/month from
  the due date does not reproduce what SUNAT charges (S/53 vs S/124 for 11/2025).

`f616 declarar` never presents or pays. It leaves the form in the tray.

**The older `f616 declare`** (no accent) drives the form too but predates all of
this. Its `ingresoPEN` and `retenciones` fields are declared in the schema and
then ignored by the code. Prefer `declarar`.

### API & Schema

```bash
sunat-cli api token              # Validate OAuth2 credentials without printing the token
sunat-cli schema rhe             # JSON schema for RHE fields
sunat-cli schema f616            # JSON schema for F616 fields
```

Use `sunat-cli schema <resource>` to get machine-readable field definitions before constructing payloads.

## Output Formats

All commands support `--output <format>`:
- `auto` (default): JSON when stdout is not a terminal, a human view when it is
- `json`: JSON always
- `table`: the human view always, even under a pipe

**You do not need to pass anything.** Capturing stdout makes it non-interactive,
so `auto` already gives you JSON. `-o json` only matters when you want JSON while
attached to a terminal.

Data goes to stdout, diagnostics to stderr. A failing command leaves stdout empty
and reports on stderr, so `cmd > out.json` never mixes an error into the file you
are about to parse.

Some commands emit next-step hints on **stderr**, one NDJSON object per line,
shaped `{"type":"next-step","command":"...","description":"..."}`. They tell you
what to run next without re-planning. Ignore stderr and stdout is unchanged.

Two exceptions, both deliberate: `skills get <name>` serves raw markdown rather
than JSON, because a document escaped inside a JSON string is unreadable, and
`--params` takes JSON *in* rather than controlling output.

## Common Workflows

**Monthly routine (4ta categoria)**:
1. `sunat-cli login --nueva-plataforma`
2. Open the F616 in the browser (menu → Trabajadores Independientes - 616)
3. `sunat-cli f616 declarar periodo 2026-07`
4. `sunat-cli f616 declarar ingreso --fecha 14/07/2026 --monto <bruto en soles> --cliente "<nombre>"`
5. `sunat-cli f616 declarar estado` and check casilla 355 against your own figure
6. `sunat-cli f616 declarar bandeja`
7. Present and pay from the portal yourself

**Filing months that went by**: same loop, one period at a time, **reloading the
form between periods**. Eight periods spanning nine months were filed this way on
2026-08-22 without emitting a single RHE.

**Emit an RHE**:
1. `sunat-cli login`
2. `sunat-cli rhe emit --params '{"empresa":"Cliente Ejemplo","tipoDoc":"SIN DOCUMENTO","descripcion":"Servicios de desarrollo de software - Marzo 2026","monto":6700,"moneda":"USD","medioPago":"TRANSFERENCIA","tipoCambio":3.75}' --dry-run`
3. `sunat-cli rhe verify --month 2026-03`

## Error Handling

- Session expired: re-run `sunat-cli login`
- `Error en la invocación`: enter Nueva Plataforma from SOL viejo, not direct URL login
- reCAPTCHA required: keep browser flow supervised
- Network timeout: retry, SUNAT portals are slow

## More

```bash
sunat-cli skills get schemas     # field specs for RHE and F616 rows
sunat-cli skills get endpoints   # the SUNAT endpoints behind each command
sunat-cli skills list            # everything this version ships
```
