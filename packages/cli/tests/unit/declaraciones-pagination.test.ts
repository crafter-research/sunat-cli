import { describe, expect, test } from "bun:test";
import { parseListaPagination } from "../../src/declaraciones/parse.ts";
import {
	buildListaExpression,
	collectDeclaraciones,
	createDeclaracionesRequester,
	SERVLET_PATH,
} from "../../src/declaraciones/portal.ts";

function page(ids: string[], current = 1, size = 2): string {
	return `<h3>Consulta de Declaraciones</h3><table>${ids.map((id) => `<tr><td>1</td><td>10/03/2026</td><td>202602</td><td>0601</td><td>SYNTHETIC</td><td>${id}</td><td><a href="javascript:constanciaNP(${id},'0601')">Comprobante</a></td></tr>`).join("")}</table><form name="formPaginacion" method="post" action="ConsultaDeclaracion.jsp"><input name="pagina" value="${current}"><input name="tamanioPagina" value="${size}"></form>`;
}

function fixtureRequester(pages: string[]) {
	const calls: string[] = [];
	return {
		calls,
		request: async (expression: string) => {
			calls.push(expression);
			if (!pages.length) throw new Error("Unexpected extra page request");
			return { ok: true, status: 200, html: pages.shift() as string };
		},
	};
}

describe("declaraciones pagination", () => {
	test("collects all pages, deduplicating overlaps in encounter order", async () => {
		const { calls, request } = fixtureRequester([page(["100", "101"]), page(["101", "102"], 2), page(["103"], 3)]);
		const rows = await collectDeclaraciones("01/03/2026", "31/03/2026", request);
		expect(rows.map((row) => row.numOrden)).toEqual(["100", "101", "102", "103"]);
		expect(calls).toHaveLength(3);
		expect(calls[0]).toContain(SERVLET_PATH);
		for (const [index, expression] of calls.entries()) {
			expect(expression).toContain("fechaDesde=01%2F03%2F2026");
			expect(expression).toContain("fechaHasta=31%2F03%2F2026");
			if (index > 0) {
				expect(expression).toContain("/cl-ti-itdeclpagcon-mepeco/ConsultaDeclaracion.jsp");
				expect(expression).toContain(`pagina=${index + 1}`);
				expect(expression).toContain("tamanioPagina=2");
				expect(expression).not.toContain("accion=lista");
			}
		}
	});

	test("keeps distinct forms and payment presentations with the same order number", async () => {
		const html = page(["100", "101", "102", "103"], 1, 4)
			.replace("constanciaNP(101,'0601')", "constanciaNP(100,'0621')")
			.replace("constanciaNP(102,'0601')", "comprobante('1663',7001,'',100)")
			.replace("constanciaNP(103,'0601')", "comprobante('1663',7002,'',100)");
		const { request } = fixtureRequester([html, page(["104"], 2, 4)]);
		expect(
			(await collectDeclaraciones("01/03/2026", "31/03/2026", request)).map((row) => [
				row.formulario,
				row.numOrden,
				row.numPresentacion,
			]),
		).toEqual([
			["0601", "100", undefined],
			["0621", "100", undefined],
			["1663", "100", "7001"],
			["1663", "100", "7002"],
			["0601", "104", undefined],
		]);
	});

	test("does not paginate a short page or a response without pagination controls", async () => {
		for (const html of [page(["100"]), page(["100", "101"]).replace(/<form[\s\S]*?<\/form>/, "")]) {
			const { calls, request } = fixtureRequester([html]);
			expect((await collectDeclaraciones("01/03/2026", "31/03/2026", request)).length).toBeGreaterThan(0);
			expect(calls).toHaveLength(1);
		}
	});

	test("an empty-range notice ends pagination, including an exactly full final page", async () => {
		for (const pages of [
			["No se encontraron declaraciones"],
			[page(["100", "101"]), "No se encontraron declaraciones"],
		]) {
			const expected = pages.length === 1 ? 0 : 2;
			const { request } = fixtureRequester(pages);
			expect(await collectDeclaraciones("01/03/2026", "31/03/2026", request)).toHaveLength(expected);
		}
	});

	test("fails rather than returning partial rows when SUNAT repeats or reorders a page", async () => {
		for (const ids of [
			["100", "101"],
			["101", "100"],
		]) {
			const { calls, request } = fixtureRequester([page(["100", "101"]), page(ids, 2)]);
			await expect(collectDeclaraciones("01/03/2026", "31/03/2026", request)).rejects.toMatchObject({
				code: "pagination-stalled",
			});
			expect(calls).toHaveLength(2);
		}
	});

	test("rejects a server that keeps reporting the first page", async () => {
		const { request } = fixtureRequester([page(["100", "101"]), page(["102", "103"], 1)]);
		await expect(collectDeclaraciones("01/03/2026", "31/03/2026", request)).rejects.toMatchObject({
			code: "invalid-pagination",
		});
	});

	test("rejects a full later page with missing controls or a changed page size", async () => {
		for (const html of [page(["102", "103"], 2).replace(/<form[\s\S]*?<\/form>/, ""), page(["102"], 2, 10)]) {
			const { request } = fixtureRequester([page(["100", "101"]), html]);
			await expect(collectDeclaraciones("01/03/2026", "31/03/2026", request)).rejects.toMatchObject({
				code: "invalid-pagination",
			});
		}
	});

	test("executes pagination POSTs with the original date filters", async () => {
		const expression = buildListaExpression("01/03/2026", "31/03/2026", { pagina: 2, tamanioPagina: 25 });
		const execute = new Function("fetch", `return ${expression}`);
		const response = await execute(async (path: string, init: RequestInit) => {
			expect(path).toBe("/cl-ti-itdeclpagcon-mepeco/ConsultaDeclaracion.jsp");
			expect(init.method).toBe("POST");
			expect(init.credentials).toBe("include");
			const body = new URLSearchParams(String(init.body));
			expect(Object.fromEntries(body)).toEqual({
				num_pres: "",
				cod_for: "",
				num_ord: "",
				fechaDesde: "01/03/2026",
				fechaHasta: "31/03/2026",
				pagina: "2",
				tamanioPagina: "25",
			});
			return new Response(page(["100"], 2, 25));
		});
		expect(JSON.parse(response)).toMatchObject({ ok: true, status: 200 });
	});

	for (const response of [
		{ ok: false, status: 503, html: "" },
		{ ok: false, status: 0, html: "" },
		{ ok: true, status: 200, html: '<input id="txtContrasena">' },
		{ ok: true, status: 200, html: "<html>Maintenance</html>" },
	]) {
		test(`does not return partial results after a later-page failure: ${JSON.stringify(response)}`, async () => {
			let calls = 0;
			await expect(
				collectDeclaraciones("01/03/2026", "31/03/2026", async () =>
					++calls === 1 ? { ok: true, status: 200, html: page(["100", "101"]) } : response,
				),
			).rejects.toMatchObject({
				code:
					response.status === 503
						? "http-error"
						: response.status === 0
							? "network"
							: response.html.includes("txtContrasena")
								? "session-expired"
								: "unexpected-page",
			});
		});
	}

	test("stops at the page bound without returning a partial success", async () => {
		let calls = 0;
		await expect(
			collectDeclaraciones("01/03/2026", "31/03/2026", async () => {
				calls++;
				return { ok: true, status: 200, html: page([String(calls)], calls, 1) };
			}),
		).rejects.toMatchObject({ code: "pagination-limit" });
		expect(calls).toBe(100);
	});

	test("pagination continues through the existing paced requester", async () => {
		let calls = 0;
		const waits: number[] = [];
		const request = createDeclaracionesRequester(
			{
				evalIn: async () => ({
					val: JSON.stringify({ ok: true, status: 200, html: ++calls === 1 ? page(["100", "101"]) : page(["102"], 2) }),
				}),
			},
			{
				now: () => 10_000,
				sleep: async (ms) => {
					waits.push(ms);
				},
			},
		);
		expect(await collectDeclaraciones("01/03/2026", "31/03/2026", request)).toHaveLength(3);
		expect(waits).toEqual([1200]);
	});
});

describe("pagination form parsing", () => {
	test("does not guess page numbering or size from uninitialized controls", async () => {
		const html = page(["100"]).replace('value="1"', 'value=""').replace('value="2"', 'value=""');
		const { request } = fixtureRequester([html]);
		await expect(collectDeclaraciones("01/03/2026", "31/03/2026", request)).rejects.toMatchObject({
			code: "invalid-pagination",
		});
	});

	test("reads fields independently of attribute order and quote style", () => {
		expect(
			parseListaPagination(
				`<form action='ConsultaDeclaracion.jsp' name='formPaginacion'><input value='2' name='pagina'><input value=25 name=tamanioPagina></form>`,
			),
		).toEqual({ pagina: 2, tamanioPagina: 25 });
	});

	test("reads the selected page size and ignores unrelated forms", () => {
		expect(
			parseListaPagination(
				`<form name="other"><input name="pagina" value="99"></form><form name="formPaginacion"><input name="pagina" value="1"><select name="tamanioPagina"><option value="10">10</option><option selected value="25">25</option></select></form>`,
			),
		).toEqual({ pagina: 1, tamanioPagina: 25 });
	});

	for (const value of ["0", "-1", "2x", "1.5", "9007199254740992", ""]) {
		test(`rejects an invalid initialized page size ${JSON.stringify(value)}`, () => {
			expect(() => parseListaPagination(page(["100"]).replace('value="2"', `value="${value}"`))).toThrow(/pagination/i);
		});
	}

	test("pagination expressions retain cookies without exposing them or following external URLs", () => {
		const expression = buildListaExpression("01/03/2026", "31/03/2026", { pagina: 2, tamanioPagina: 25 });
		expect(expression).toContain("credentials:'include'");
		expect(expression).not.toContain("document.cookie");
		expect(expression).not.toMatch(/presentar|pagar|rectific/i);
	});
});
