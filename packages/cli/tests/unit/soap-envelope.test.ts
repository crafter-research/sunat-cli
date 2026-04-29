import { describe, expect, test } from "bun:test";
import {
	buildGetStatusEnvelope,
	buildSendBillEnvelope,
	buildSendSummaryEnvelope,
	SUNAT_ENDPOINTS_FAC,
} from "../../src/cpe/soap/client.ts";

describe("buildSendBillEnvelope", () => {
	test("includes WS-Security UsernameToken with username and password", () => {
		const env = buildSendBillEnvelope({
			username: "20100070970MODATOS1",
			password: "moddatos",
			filename: "20100070970-01-F001-1",
			zipBase64: "UEsDBBQ=",
		});
		expect(env).toContain("<wsse:Username>20100070970MODATOS1</wsse:Username>");
		expect(env).toContain("<wsse:Password");
		expect(env).toContain(">moddatos<");
	});

	test("body includes sendBill fileName and contentFile", () => {
		const env = buildSendBillEnvelope({
			username: "u",
			password: "p",
			filename: "20100070970-01-F001-1",
			zipBase64: "UEsDBBQ=",
		});
		expect(env).toContain("<fileName>20100070970-01-F001-1.zip</fileName>");
		expect(env).toContain("<contentFile>UEsDBBQ=</contentFile>");
	});

	test("escapes XML in username/password", () => {
		const env = buildSendBillEnvelope({
			username: "user<&>",
			password: "p",
			filename: "f",
			zipBase64: "x",
		});
		expect(env).toContain("user&lt;&amp;&gt;");
	});
});

describe("SUNAT_ENDPOINTS_FAC", () => {
	test("beta endpoint", () => {
		expect(SUNAT_ENDPOINTS_FAC.beta).toContain("e-beta.sunat.gob.pe");
		expect(SUNAT_ENDPOINTS_FAC.beta).toContain("/billService");
	});
	test("prod endpoint", () => {
		expect(SUNAT_ENDPOINTS_FAC.prod).toContain("e-factura.sunat.gob.pe");
	});
});

describe("buildSendSummaryEnvelope", () => {
	test("uses ser:sendSummary body element", () => {
		const env = buildSendSummaryEnvelope({
			username: "20000000001MODDATOS",
			password: "moddatos",
			filename: "20000000001-RC-20260430-1",
			zipBase64: "UEsDBBQ=",
		});
		expect(env).toContain("<ser:sendSummary>");
		expect(env).toContain("<fileName>20000000001-RC-20260430-1.zip</fileName>");
		expect(env).toContain("<contentFile>UEsDBBQ=</contentFile>");
	});

	test("includes WS-Security UsernameToken", () => {
		const env = buildSendSummaryEnvelope({ username: "u", password: "p", filename: "f", zipBase64: "z" });
		expect(env).toContain("<wsse:Username>u</wsse:Username>");
		expect(env).toContain(">p<");
	});
});

describe("buildGetStatusEnvelope", () => {
	test("uses ser:getStatus body with ticket", () => {
		const env = buildGetStatusEnvelope({
			username: "20000000001MODDATOS",
			password: "moddatos",
			ticket: "1234567890123",
		});
		expect(env).toContain("<ser:getStatus>");
		expect(env).toContain("<ticket>1234567890123</ticket>");
	});

	test("escapes ticket value", () => {
		const env = buildGetStatusEnvelope({ username: "u", password: "p", ticket: "abc<&>" });
		expect(env).toContain("abc&lt;&amp;&gt;");
	});
});
