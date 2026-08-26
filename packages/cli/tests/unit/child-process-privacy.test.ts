import { describe, expect, test } from "bun:test";
import { privateChildEnv } from "../../src/data/child-process.ts";

describe("child process environment privacy", () => {
	test("passes runtime plumbing without forwarding application credentials", () => {
		const env = {
			PATH: "/usr/bin",
			HOME: "/tmp/home",
			DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus",
			AGENT_BROWSER_HEADED: "1",
			NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
			NPM_CONFIG_TOKEN: "private-npm-token",
			SUNAT_PASSWORD: "private-clave-sol",
			CPE_CERT_PASSWORD: "private-certificate-password",
			DATABASE_URL: "postgres://private-database",
			UNRELATED_API_TOKEN: "private-api-token",
		};
		const child = privateChildEnv(env, ["NPM_CONFIG_REGISTRY"], ["AGENT_BROWSER_"]);

		expect(child).toEqual({
			PATH: "/usr/bin",
			HOME: "/tmp/home",
			DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus",
			AGENT_BROWSER_HEADED: "1",
			NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
		});
	});

	test("preserves Windows runtime paths without forwarding credentials", () => {
		const child = privateChildEnv({
			Path: "C:\\Program Files\\nodejs",
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			TEMP: "C:\\Windows\\Temp",
			USERPROFILE: "C:\\Users\\runner",
			LOCALAPPDATA: "C:\\Users\\runner\\AppData\\Local",
			SUNAT_PASSWORD: "private-clave-sol",
		});

		expect(child).toEqual({
			Path: "C:\\Program Files\\nodejs",
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			TEMP: "C:\\Windows\\Temp",
			USERPROFILE: "C:\\Users\\runner",
			LOCALAPPDATA: "C:\\Users\\runner\\AppData\\Local",
		});
	});
});
