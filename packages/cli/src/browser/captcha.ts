import * as browser from "./client.ts";

export async function solveReCaptcha(): Promise<boolean> {
	let coords: string;
	try {
		coords = await browser.evalJS(
			"(function(){ var f = document.querySelector('iframe[title*=\"reCAPTCHA\"]'); if (!f) return 'null'; var r = f.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + 30), y: Math.round(r.y + r.height/2)}); })()",
		);
	} catch {
		return false;
	}

	if (!coords || coords === "null" || coords === "undefined") return false;

	let x: number;
	let y: number;
	try {
		const parsed = JSON.parse(coords);
		x = Number(parsed.x);
		y = Number(parsed.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	} catch {
		return false;
	}

	console.log(`  reCAPTCHA at (${x}, ${y})`);
	await browser.mouseMove(x, y);
	await browser.sleep(500);
	await browser.mouseDown();
	await browser.sleep(100);
	await browser.mouseUp();
	await browser.sleep(3000);
	return true;
}
