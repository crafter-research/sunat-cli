import { spawn } from "child_process";

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
