import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BuzonPortalError, buildBuzonRequestExpression, createBuzonRequester } from "../../src/buzon/portal.ts";

const PORTAL_SOURCE = readFileSync(new URL("../../src/buzon/portal.ts", import.meta.url), "utf8");

describe("Buzón portal boundary", () => {
	test("installs the detail abort route before opening the visor", () => {
		const route = PORTAL_SOURCE.indexOf("await browser.routeAbort(DETAIL_ROUTE)");
		const click = PORTAL_SOURCE.indexOf("await browser.click(ref)");
		expect(PORTAL_SOURCE).toContain(`const DETAIL_ROUTE = \`**\${DETAIL_PATH}*\`;`);
		expect(route).toBeGreaterThan(-1);
		expect(click).toBeGreaterThan(route);
	});

	test("the list expression contains only metadata query parameters", () => {
		const expression = buildBuzonRequestExpression("/ol-ti-itvisornoti/visor/listNotiMenPag", {
			query: { tipoMsj: "2", page: "1", des_asunto: "" },
		});
		expect(expression).toContain("listNotiMenPag");
		expect(expression).not.toContain("obtenerDetalleNotiMen");
		expect(expression).not.toContain("cookie");
		expect(expression).not.toContain("location.search");
	});

	test("retries throttled metadata responses with bounded backoff", async () => {
		const responses = [
			{ ok: false, status: 429, data: null },
			{ ok: true, status: 200, data: { rows: [] } },
		];
		const sleeps: number[] = [];
		const requester = createBuzonRequester(
			{
				evalIn: async () => ({ val: JSON.stringify(responses.shift()) }),
			},
			{ sleep: async (ms) => void sleeps.push(ms), now: () => 10_000 },
		);
		expect(await requester<{ rows: unknown[] }>("/list")).toEqual({ rows: [] });
		expect(sleeps).toEqual([2000]);
	});

	test("serializes consecutive metadata requests and applies the pacing gap", async () => {
		const calls: string[] = [];
		const sleeps: number[] = [];
		const requester = createBuzonRequester(
			{
				evalIn: async (expression) => {
					calls.push(expression);
					return { val: JSON.stringify({ ok: true, status: 200, data: {} }) };
				},
			},
			{ sleep: async (ms) => void sleeps.push(ms), now: () => 10_000 },
		);
		await Promise.all([requester("/first"), requester("/second")]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain("/first");
		expect(calls[1]).toContain("/second");
		expect(sleeps).toEqual([1200]);
	});

	test("does not retry a non-retryable portal rejection", async () => {
		let calls = 0;
		const requester = createBuzonRequester(
			{
				evalIn: async () => {
					calls++;
					return { val: JSON.stringify({ ok: false, status: 403, data: null }) };
				},
			},
			{ sleep: async () => {}, now: () => 10_000 },
		);
		try {
			await requester("/list");
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(BuzonPortalError);
			expect(error).toMatchObject({ status: 403, code: "request-failed" });
		}
		expect(calls).toBe(1);
	});

	test("stops after three retryable failures", async () => {
		let calls = 0;
		const sleeps: number[] = [];
		const requester = createBuzonRequester(
			{
				evalIn: async () => {
					calls++;
					return { val: JSON.stringify({ ok: false, status: 503, data: null }) };
				},
			},
			{ sleep: async (ms) => void sleeps.push(ms), now: () => 10_000 },
		);
		try {
			await requester("/list");
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ status: 503, code: "throttled" });
		}
		expect(calls).toBe(3);
		expect(sleeps).toEqual([2000, 4000]);
	});
});
