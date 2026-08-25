import { describe, expect, test } from "bun:test";
import { renderTokenStatus } from "../../src/commands/api/index.ts";
import { formatDuration } from "../../src/utils/dates.ts";
import { maskSecret, setColorOverride, stripAnsi } from "../../src/utils/style.ts";

/**
 * `api token` mints a real credential against SUNAT, so it is never executed
 * here. These assert the render function and its two helpers directly, which is
 * where the disclosure decision actually lives.
 */

// Built at runtime rather than pasted as a literal. The value is synthetic (a
// sample RUC and the word "signature"), but a hardcoded JWT-shaped string trips
// the repo's secret scanner, and turning that gate off to keep a fixture would
// be the wrong trade.
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "20601234567" })}.sIgNaTuRe_Xyz9`;

describe("maskSecret", () => {
	test("keeps a head and tail so two credentials stay distinguishable", () => {
		expect(maskSecret(JWT)).toBe("eyJh…Xyz9");
	});

	test("never contains the secret it masks", () => {
		expect(maskSecret(JWT)).not.toContain(JWT);
		expect(JWT).not.toContain(maskSecret(JWT));
	});

	test("hides the length of the secret", () => {
		const short = maskSecret(`${JWT}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
		expect(maskSecret(JWT).length).toBe(short.length);
	});

	test("fully masks a secret too short to preview safely", () => {
		expect(maskSecret("abcd1234")).toBe("••••••••");
		expect(maskSecret("")).toBe("••••••••");
	});
});

describe("formatDuration", () => {
	test("renders an OAuth hour as a phrase, not a second count", () => {
		expect(formatDuration(3600)).toBe("1h");
	});

	test("carries minutes alongside hours", () => {
		expect(formatDuration(5400)).toBe("1h 30min");
	});

	test("rounds down so a token never looks fresher than it is", () => {
		expect(formatDuration(119)).toBe("1min");
	});

	test("reports sub-minute and dead tokens plainly", () => {
		expect(formatDuration(45)).toBe("45s");
		expect(formatDuration(0)).toBe("expired");
		expect(formatDuration(-10)).toBe("expired");
		expect(formatDuration(Number.NaN)).toBe("expired");
	});
});

describe("renderTokenStatus", () => {
	const status = { tokenType: "Bearer", expiresIn: 3600, preview: maskSecret(JWT) };

	test("answers expiry in a readable form and never prints the credential", () => {
		const text = stripAnsi(renderTokenStatus(status).join("\n"));
		expect(text).toContain("API credentials valid");
		expect(text).toContain("Bearer");
		expect(text).toContain("expires in 1h");
		expect(text).toContain("eyJh…Xyz9");
		expect(text).not.toContain(JWT);
		expect(text).not.toContain("3600");
	});

	test("carries no ANSI once colour is off", () => {
		setColorOverride(false);
		try {
			const text = renderTokenStatus(status).join("\n");
			expect(text).toBe(stripAnsi(text));
		} finally {
			setColorOverride(null);
		}
	});

	test("styles the human branch when colour is on, without leaking the token", () => {
		setColorOverride(true);
		try {
			const text = renderTokenStatus(status).join("\n");
			expect(text).not.toBe(stripAnsi(text));
			expect(text).not.toContain(JWT);
		} finally {
			setColorOverride(null);
		}
	});
});
