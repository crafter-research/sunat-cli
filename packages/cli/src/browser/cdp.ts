import { execSync, spawn } from "child_process";

async function getCdpUrl(): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn("agent-browser", ["--session", "sunat", "get", "cdp-url"]);
		let out = "";
		proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
		proc.on("close", (code) => (code === 0 ? resolve(out.trim().replace(/\x1b\[[0-9;]*m/g, "")) : reject(new Error("get cdp-url failed"))));
		proc.on("error", reject);
	});
}

export async function setInputValueInIframe(elementId: string, value: string): Promise<boolean> {
	const cdpUrl = await getCdpUrl();
	const escapedValue = value.replace(/'/g, "\\'");
	const script = `(function(){ var el = document.getElementById('${elementId}'); if (!el) return 'not_found'; var ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; ns.call(el, '${escapedValue}'); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); el.dispatchEvent(new Event('blur', {bubbles:true})); return 'SET:' + el.value; })()`;

	return new Promise((resolve, reject) => {
		const ws = new WebSocket(cdpUrl);
		const timeout = setTimeout(() => { ws.close(); reject(new Error("CDP timeout")); }, 20000);
		let id = 1;
		let sessionId = "";

		ws.onmessage = (event) => {
			const data = JSON.parse(event.data as string);

			// Step 1 response: targets list
			if (data.id === 1) {
				const page = data.result?.targetInfos?.find((t: any) => t.url?.includes("sunat") && t.type === "page");
				if (!page) { done(false, "No SUNAT page"); return; }
				ws.send(JSON.stringify({ id: 2, method: "Target.attachToTarget", params: { targetId: page.targetId, flatten: true } }));
			}

			// Step 2 response: attached
			if (data.id === 2 && data.result?.sessionId) {
				sessionId = data.result.sessionId;
				ws.send(JSON.stringify({ id: 3, method: "Page.getFrameTree", sessionId }));
			}

			// Step 3 response: frame tree
			if (data.id === 3 && data.result?.frameTree) {
				const frames = flattenFrames(data.result.frameTree);
				for (let i = 0; i < frames.length; i++) {
					ws.send(JSON.stringify({
						id: 10 + i,
						method: "Page.createIsolatedWorld",
						sessionId,
						params: { frameId: frames[i].id, worldName: "sunat-cli" },
					}));
				}
			}

			// Step 4: isolated world created → evaluate
			if (data.id >= 10 && data.id < 50 && data.result?.executionContextId) {
				ws.send(JSON.stringify({
					id: 100 + data.id,
					method: "Runtime.evaluate",
					sessionId,
					params: { expression: script, contextId: data.result.executionContextId, returnByValue: true },
				}));
			}

			// Step 5: evaluate result
			if (data.id >= 110 && data.result?.result?.value) {
				const val = String(data.result.result.value);
				if (val.startsWith("SET:")) {
					done(true);
				}
			}
		};

		ws.onopen = () => {
			ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
		};

		ws.onerror = () => done(false, "WebSocket error");

		function done(success: boolean, error?: string) {
			clearTimeout(timeout);
			ws.close();
			if (success) resolve(true);
			else reject(new Error(error || "Failed to set value"));
		}
	});
}

function flattenFrames(tree: any): any[] {
	const frames = [tree.frame];
	for (const child of tree.childFrames || []) frames.push(...flattenFrames(child));
	return frames;
}


// ---------------------------------------------------------------------------
// Sesión CDP persistente
//
// `setInputValueInIframe` (arriba) abre y cierra una conexión por escritura y
// usa `createIsolatedWorld`. Sirve para un campo suelto, pero no para un flujo
// largo: el mundo aislado no ve las variables de la página, y reconectar por
// cada campo es lento.
//
// Lo de abajo mantiene una sesión abierta contra el contexto REAL del frame.
// Es lo que necesita el F616, cuyo iframe de `e-plataformaunica` es
// cross-origin: `browser.evalJS` no entra y `browser.fill` escribe el valor
// sin disparar los handlers de jQuery Validate.
// ---------------------------------------------------------------------------


export interface CdpSession {
	/** Evalúa una expresión dentro del contexto del formulario. */
	evalIn: (expr: string) => Promise<{ val?: unknown; err?: string }>;
	/** Canal CDP crudo, para dominios que `evalIn` no cubre (descargas, red). */
	send: (method: string, params?: Record<string, unknown>) => Promise<any>;
	close: () => void;
}

/**
 * Escribe un valor disparando los eventos que los handlers del portal
 * escuchan. Un `el.value = x` a secas no alcanza: jQuery Validate se
 * engancha a input/keyup/change/blur.
 */
export const NATIVE_SETTER = `function(id,v){var el=document.getElementById(id);if(!el)return 'NO_FIELD:'+id;
var proto=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);
['input','keyup','change','blur'].forEach(function(t){el.dispatchEvent(new Event(t,{bubbles:true}))});
return el.value;}`;

/** Busca el puerto de debugging del Chrome que levantó agent-browser. */
export async function findDebuggerPort(): Promise<number> {
	let out = "";
	try {
		out = execSync(
			`for pid in $(pgrep -f "Google Chrome" | head -8); do lsof -nP -iTCP -sTCP:LISTEN -a -p $pid 2>/dev/null | awk 'NR>1{print $9}'; done | sort -u`,
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		);
	} catch {
		throw new Error("No pude inspeccionar los puertos de Chrome.");
	}
	for (const line of out.trim().split("\n")) {
		const port = Number(line.split(":").pop());
		if (!port) continue;
		try {
			const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
			if (r.ok) return port;
		} catch {}
	}
	throw new Error("No encontré el puerto de debugging de Chrome. ¿Está abierto el navegador?");
}

export interface ConnectOpts {
	/** Substring de la URL de la pestaña. Default: el menú de la Nueva Plataforma. */
	pageUrl?: string;
	/** Origin del contexto a usar. Default: e-plataformaunica. */
	origin?: string;
	/** Expresión que debe dar truthy para elegir el contexto correcto. */
	probe?: string;
}

/**
 * Se ata a la pestaña del portal y devuelve un evaluador dentro del frame
 * del formulario.
 *
 * `probe` importa: un mismo origin puede tener más de un contexto vivo, y
 * solo uno tiene el DOM que interesa. Sin probe se toma el primero.
 */
export async function connect(opts: ConnectOpts = {}): Promise<CdpSession> {
	const pageUrl = opts.pageUrl ?? "MenuInternetPlataforma";
	const origin = opts.origin ?? "plataformaunica";

	const port = await findDebuggerPort();
	const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
		type: string; url: string; webSocketDebuggerUrl: string;
	}>;
	const page = targets.find((t) => t.type === "page" && t.url.includes(pageUrl));
	if (!page) throw new Error(`No encontré la pestaña del portal (busqué "${pageUrl}").`);

	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map<number, (v: unknown) => void>();
	const contexts: Array<{ id: number; origin: string }> = [];

	ws.addEventListener("message", (e: MessageEvent) => {
		const m = JSON.parse(String(e.data));
		if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
		if (m.id && pending.has(m.id)) { pending.get(m.id)?.(m); pending.delete(m.id); }
	});
	await new Promise((r) => ws.addEventListener("open", r));

	const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
		const myId = ++id;
		return new Promise((res) => { pending.set(myId, res as (v: unknown) => void); ws.send(JSON.stringify({ id: myId, method, params })); });
	};

	await send("Runtime.enable");
	await send("Page.enable");

	// El contexto puede tardar en registrarse, sobre todo tras recargar.
	let ctx: { id: number } | undefined;
	for (let i = 0; i < 20 && !ctx; i++) {
		const candidates = contexts.filter((c) => (c.origin || "").includes(origin));
		if (opts.probe) {
			for (const c of candidates) {
				const r = await send("Runtime.evaluate", { expression: opts.probe, contextId: c.id, returnByValue: true });
				if (r.result?.result?.value) { ctx = c; break; }
			}
		} else if (candidates.length) {
			ctx = candidates[0];
		}
		if (!ctx) await new Promise((r) => setTimeout(r, 500));
	}
	if (!ctx) { ws.close(); throw new Error(`No encontré el contexto del formulario (origin "${origin}").`); }

	const evalIn = async (expression: string) => {
		const r = await send("Runtime.evaluate", { expression, contextId: ctx.id, returnByValue: true, awaitPromise: true });
		if (r.result?.exceptionDetails) {
			const d = r.result.exceptionDetails;
			return { err: String(d.exception?.description || d.text || "").slice(0, 240) };
		}
		return { val: r.result?.result?.value };
	};

	return { evalIn, send, close: () => ws.close() };
}
