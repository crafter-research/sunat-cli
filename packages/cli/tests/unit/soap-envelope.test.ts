import { describe, expect, test } from "bun:test";
import { buildSendBillEnvelope, SUNAT_ENDPOINTS_FAC } from "../../src/cpe/soap/client.ts";

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
