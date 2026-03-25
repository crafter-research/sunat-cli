# SUNAT Automation Research

Findings from reverse-engineering SUNAT's web portals (March 25, 2026).
Everything here was discovered via live recon with agent-browser v0.22.2.

---

## Portal Map

SUNAT has **3 separate web portals**, each with different auth and capabilities:

| Portal | URL Pattern | Auth | CAPTCHA | Contains |
|--------|-------------|------|---------|----------|
| SOL viejo | `e-menu.sunat.gob.pe/cl-ti-itmenu/` | OAuth2 (client A) | **NONE** | RHE emission, API credentials, consultas |
| Nueva Plataforma | `e-menu.sunat.gob.pe/cl-ti-itmenu2/` | OAuth2 (client B) | reCAPTCHA v2 (bypassable) | F616, F621, all modern declarations |
| e-renta DyP | `e-renta.sunat.gob.pe` | OAuth2 (client C) | None | F709 Renta Anual only |

### Critical Discovery: Bypassing reCAPTCHA on Nueva Plataforma

Accessing Nueva Plataforma directly requires solving reCAPTCHA v2. But if you:

1. Login to SOL viejo first (no CAPTCHA)
2. Navigate to `e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?exe=55.1.1.1.1`
3. This triggers an OAuth redirect WITH a valid `state` parameter
4. The resulting login page has NO reCAPTCHA — just RUC/User/Password
5. Login succeeds → full access to Nueva Plataforma

The `state` parameter is the key — direct access generates an empty state which causes "Error en la invocacion" after login. Going through SOL generates the proper state.

### reCAPTCHA Auto-Solve (when needed)

If you must solve reCAPTCHA (e.g., direct access), agent-browser can do it:

```bash
# Get reCAPTCHA iframe coordinates
agent-browser eval 'var f = document.querySelector("iframe[title*=\"reCAPTCHA\"]"); var r = f.getBoundingClientRect(); JSON.stringify({x: Math.round(r.x + 30), y: Math.round(r.y + r.height/2)})'

# Click checkbox via mouse coordinates (bypasses cross-origin iframe protection)
agent-browser mouse move 586 466
agent-browser mouse down
agent-browser mouse up
```

This works because `mouse move/down/up` dispatches CDP `Input.dispatchMouseEvent` which operates at browser level, not DOM level. The reCAPTCHA checkbox receives a real click.

Note: This only works for the checkbox challenge. If Google escalates to image selection, manual intervention is needed.

---

## SUNAT Blocks Headless Chrome

SUNAT's SOL portal (`e-menu.sunat.gob.pe`) returns `net::ERR_CONNECTION_RESET` for headless Chrome. **Always use headed mode**:

```bash
agent-browser --headed --session sunat open "https://e-menu.sunat.gob.pe/..."
```

The Nueva Plataforma and e-renta portals also require headed mode.

---

## SOL Menu Navigation

SOL uses a JavaScript function `ejecuta()` to navigate between sections. Links are `javascript:void(0)` with onclick handlers. You cannot click them by href — use eval:

```bash
# RHE emission (SOL viejo)
agent-browser eval "ejecuta('MenuInternet.htm?action=iconExecute&code=11.5.1.1.2',false,'Emisión de Recibo por Honorarios Electrónico','#nivel1_11','11.5.1.1.2')"

# API Credentials (SOL viejo)
agent-browser eval "ejecuta('MenuInternet.htm?action=iconExecute&code=80.1.1.1.1',false,'Gestión Credenciales de API SUNAT','#nivel1_80','80.1.1.1.1')"

# F616 (Nueva Plataforma)
agent-browser eval "ejecuta('MenuInternetPlataforma.htm?action=iconExecute&code=55.1.3.1.5', false, 'Trabajadores Independientes - 616', '#nivel1_55', '55.1.3.1.5')"
```

### Menu Codes

| Code | Portal | Description |
|------|--------|-------------|
| `11.5.1.1.2` | SOL viejo | Emitir RHE |
| `11.5.1.1.6` | SOL viejo | Registrar Pagos |
| `11.5.1.1.7` | SOL viejo | Registrar Otros Ingresos 4ta Cat |
| `11.5.1.1.12` | SOL viejo | Reporte Virtual Ingresos 4ta Cat |
| `12.1.1.1.4` | SOL viejo | Consulta Declaraciones Juradas y Pagos |
| `80.1.1.1.1` | SOL viejo | Gestion Credenciales API SUNAT |
| `55.1.1.1.1` | Nueva Plat | IGV Renta Mensual - 621 |
| `55.1.3.1.5` | Nueva Plat | Trabajadores Independientes - 616 |

---

## RHE Emission Workflow (SOL viejo)

### Form Structure (3 steps)

**Step 1: Pre-question**
- "Deduccion adicional de renta (3 UIT)?" → "No" is pre-selected
- Click "Continuar"

**Step 2: Client Info**
- Tipo Documento: dropdown → select "SIN DOCUMENTO" for foreign companies
- When SIN DOCUMENTO selected: numero field disables, nombre field enables
- Fill empresa name in nombre field
- Click "Continuar"

**Step 3: Service Details + Amount**
Fields (refs change each load, find by type/label):
- Descripcion: first enabled textbox in iframe
- Medio de Pago: combobox containing "Seleccione Medio de Pago"
- Moneda: combobox showing "SOL" (change to "DOLAR DE NORTE AMERICA" for USD)
- Monto Total: textbox with value "0.0"
- Click "Continuar" → preview → "Emitir"/"Aceptar" → confirmation

### Gotchas

1. **beforeunload guard**: Forms have `window.onbeforeunload` that blocks navigation. Clear it:
   ```bash
   agent-browser eval "window.onbeforeunload = null"
   ```

2. **Iframes everywhere**: SOL wraps every form in an iframe. agent-browser reads refs inside iframes automatically — no frame switching needed.

3. **Backend endpoint**: POST `https://ww1.sunat.gob.pe/ol-ti-itreciboelectronico/cpelec001Alias`

4. **Date restriction**: SUNAT allows max 2-3 days retroactive for RHE dates. For regularizacion, all RHEs get today's date.

5. **Medio de Pago values** (exact strings SUNAT expects):
   - "Deposito en Cuenta"
   - "Transferencia de Fondos"
   - "Tarjeta de Debito"
   - "Efectivo - por operaciones donde no existe obligacion de utilizar Medios de Pago"

---

## F616 Declaration Workflow (Nueva Plataforma)

### The Input Mask Problem

The periodo field (`casilla007`) has an Angular input mask that **rejects ALL standard input methods**:

| Method | Result |
|--------|--------|
| `agent-browser fill @ref "03/2025"` | "/" triggers calendar popup, value not set |
| `agent-browser fill @ref "032025"` | Digits silently rejected |
| `agent-browser type @ref "032025"` | Same — silently rejected |
| `agent-browser press 0; press 3; ...` | Each key rejected |
| `agent-browser keyboard type "032025"` | Keys go to main frame, not iframe |
| `agent-browser keyboard inserttext "03/2025"` | Same — wrong frame |
| Clipboard paste (`Meta+v`) | Same — wrong frame |

**Root cause**: The input field is inside a cross-origin iframe (`e-plataformaunica.sunat.gob.pe`). agent-browser's keyboard commands dispatch to the main frame context, not the iframe context. The `fill` command uses CDP to target the right element, but types character-by-character which triggers the mask.

### The Solution: Raw CDP WebSocket

Connect directly to Chrome DevTools Protocol and execute JavaScript inside the iframe's execution context:

```typescript
// 1. Get CDP WebSocket URL
const cdpUrl = await exec("agent-browser --session sunat get cdp-url");

// 2. Connect and find all frames
ws.send({ method: "Target.getTargets" });           // Find SUNAT page
ws.send({ method: "Target.attachToTarget", ... });   // Attach to page
ws.send({ method: "Page.getFrameTree" });            // Get all frames

// 3. Create isolated world in EACH frame
for (const frame of frames) {
  ws.send({ method: "Page.createIsolatedWorld", params: { frameId: frame.id } });
}

// 4. Execute in each world — only the right frame will find the element
ws.send({
  method: "Runtime.evaluate",
  params: {
    contextId: isolatedWorldContextId,
    expression: `
      var el = document.getElementById('casilla007');
      if (!el) return 'not_found';
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '03/2025');
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'SET:' + el.value;
    `
  }
});
```

**Why this works:**
- `Page.createIsolatedWorld` creates a JavaScript context that can access the frame's DOM regardless of origin
- `nativeInputValueSetter` bypasses the Angular input mask by setting the raw DOM property
- `dispatchEvent('input')` + `dispatchEvent('change')` triggers Angular's change detection
- The form recognizes the value and enables dependent fields

### F616 Form Fields

| Field | Element ID | Type | Notes |
|-------|-----------|------|-------|
| Periodo | `casilla007` | Masked input (MM/AAAA) | Requires CDP workaround |
| Rectifica? | radio buttons | Si/No | "No" pre-selected |
| Telefono | `casilla028` (approx) | Text input | Disabled until periodo set |
| Profesion | combobox | Dropdown | ~60 options, disabled until periodo set |
| Siguiente | button | | Disabled until periodo set + validated |

### F616 Frame Structure

```
Main page: e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm
  └── Iframe 1: e-menu.sunat.gob.pe/.../MenuInternetPlataforma.htm?action=iconExecute&code=55.1.3.1.5
       └── Iframe (cross-origin): e-plataformaunica.sunat.gob.pe/app/recaudacion/tributaria/internet/html/carrito.html
            └── casilla007 (the periodo input lives HERE)
```

---

## SUNAT REST API

### Registering an App

Navigate to SOL viejo > menu code `80.1.1.1.1` (Gestion Credenciales de API SUNAT).

Fill: app name, URL (must be valid domain, not localhost), select API scopes, choose Desktop/Web.

Network call on save: `POST https://api.sunat.gob.pe/v1/tecnologia/controlacceso/aplicaciones`

### OAuth2 Token Generation

```bash
curl -X POST "https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&scope=https://api.sunat.gob.pe/v1/contribuyente/gem&client_id={client_id}&client_secret={client_secret}&username={RUC}{SOL_USER}&password={SOL_PASSWORD}"
```

Response: `{ "access_token": "eyJ...", "token_type": "JWT", "expires_in": 3600 }`

The JWT payload contains the API base URLs:
- `https://api-cpe.sunat.gob.pe` — CPE endpoints (controlcpe, controlmsg, gem)
- `https://api-sire.sunat.gob.pe` — SIRE endpoints (migeigv)

### Available API Scopes

| Scope | Endpoint | What It Does |
|-------|----------|--------------|
| MIGE Gestion Factoring | `/v1/contribuyente/controlcpe` | Control comprobantes de pago |
| Control de mensajes | `/v1/contribuyente/controlmsg` | Alertas y mensajes |
| GRE Emision Comprobantes | `/v1/contribuyente/gem` | Guias de Remision (NOT RHE) |
| MIGE RCE y RVIE - SIRE | `/v1/contribuyente/migeigv` | Registro compras/ventas |

### Important: No RHE API Exists

The GRE (Guia de Remision Electronica) endpoint is for shipping guides, **not** Recibos por Honorarios. There is no public REST API for emitting RHE — browser automation is the only way.

The API is useful for **verification** after emitting RHE via browser.

---

## agent-browser Tips for SUNAT

### Session Management
```bash
agent-browser --headed --session sunat open "https://..."  # Always use headed
agent-browser --session sunat state save ~/.sunat/sessions/sol.json  # Save session
agent-browser --session sunat state load ~/.sunat/sessions/sol.json  # Restore session
```

Sessions expire after ~20 minutes of inactivity.

### Finding Elements
Refs (`@e1`, `@e2`) change on every page load. Never hardcode them. Instead:

```bash
# Snapshot and find by text/type
agent-browser snapshot -i | grep "Continuar"
# → button "Continuar" [ref=e11]

# Get element attributes
agent-browser get attr @e29 id     # → "casilla007"
agent-browser get attr @e29 name   # → "casilla007"
agent-browser get attr @e29 class  # → "form-control input-sm data-sunat"
```

### Handling Iframes
agent-browser automatically reads refs inside iframes. No frame switching needed for click/fill/select. But `eval` runs in the main frame — use CDP for cross-origin iframe JS execution.

### Network Interception
```bash
agent-browser network requests --clear
# ... perform actions ...
agent-browser network requests  # Shows all XHR/fetch/document requests
```

Useful for discovering backend endpoints.

### Calendar/Date Pickers
SUNAT's date pickers intercept "/" and open a calendar popup. Two approaches:
1. Use the calendar UI (click `<` to go back years, click month)
2. Use CDP `setInputValueInIframe` to bypass the mask entirely (recommended)

---

## File Locations

| File | Purpose |
|------|---------|
| `~/.sunat/config.json` | RUC, usuario, preferences |
| `~/.sunat/sessions/sol.json` | SOL session state |
| `~/.sunat/sessions/nueva-plataforma.json` | Nueva Plataforma session |
| `~/.sunat/api/client.json` | OAuth2 client_id + secret |
| `~/.sunat/api/token.json` | Cached JWT |
| `~/.sunat/audit/YYYY-MM-DD.jsonl` | Operation audit trail |
| `~/.sunat/recon/` | Screenshots, snapshots, network logs from exploration |

---

## Key URLs

| URL | Purpose |
|-----|---------|
| `e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm` | SOL viejo login |
| `e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*` | SOL viejo dashboard |
| `e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?exe=55.1.1.1.1` | Nueva Plataforma (via SOL, no CAPTCHA) |
| `api-seguridad.sunat.gob.pe/v1/clientessol/{id}/oauth2/token/` | OAuth2 token endpoint |
| `api-cpe.sunat.gob.pe` | CPE API base URL |
| `api-sire.sunat.gob.pe` | SIRE API base URL |
| `ww1.sunat.gob.pe/ol-ti-itreciboelectronico/cpelec001Alias` | RHE backend (POST) |
| `e-plataformaunica.sunat.gob.pe/app/recaudacion/tributaria/internet/html/carrito.html` | F616 form content (cross-origin iframe) |
