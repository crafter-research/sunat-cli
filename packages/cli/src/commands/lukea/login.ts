import { Command } from "commander";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { saveLukeaCredentials } from "../../data/lukea-config.ts";
import { outputSuccess, outputError } from "../../utils/output.ts";
import { audit } from "../../data/audit.ts";
import * as p from "@clack/prompts";

const LUKEA_URL = process.env.LUKEA_URL || "http://localhost:3000";

function generateState(): string {
	return randomBytes(16).toString("hex");
}

function waitForCallback(port: number, state: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			server.close();
			reject(new Error("Timeout: no response from Lukea within 2 minutes"));
		}, 120000);

		const server = createServer((req, res) => {
			const url = new URL(req.url!, `http://localhost:${port}`);
			if (url.pathname !== "/callback") {
				res.writeHead(404);
				res.end();
				return;
			}
			const key = url.searchParams.get("key");
			const returnedState = url.searchParams.get("state");
			if (returnedState !== state) {
				res.writeHead(400);
				res.end("State mismatch");
				return;
			}
			if (!key) {
				res.writeHead(400);
				res.end("Missing key");
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				"<html><body style='background:#0A0A0B;color:#F7F8F8;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh'><h2>Conectado a Lukea. Puedes cerrar esta ventana.</h2></body></html>",
			);
			clearTimeout(timeout);
			server.close();
			resolve(key);
		});

		server.listen(port);
	});
}

export function createLukeaLoginCommand(): Command {
	return new Command("login")
		.description("Conectar sunat-cli con tu cuenta Lukea")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const port = Math.floor(Math.random() * 24) + 9876;
				const state = generateState();
				const authUrl = `${LUKEA_URL}/cli/authorize?state=${state}&port=${port}`;

				if (isTTY) {
					p.intro("lukea login");
					p.log.info(`Abriendo navegador en: ${authUrl}`);
				}

				const { exec } = await import("node:child_process");
				exec(`open "${authUrl}"`);

				const spinner = isTTY ? p.spinner() : null;
				spinner?.start("Esperando autorización...");

				const apiKey = await waitForCallback(port, state);

				spinner?.stop("Autorizado.");

				saveLukeaCredentials({
					apiKey,
					apiUrl: LUKEA_URL,
					connectedAt: new Date().toISOString(),
				});

				audit({ command: "lukea login", args: { apiUrl: LUKEA_URL }, result: "success" });

				if (isTTY) {
					p.outro("Conectado a Lukea.");
				} else {
					outputSuccess("Connected to Lukea", format);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit({ command: "lukea login", args: {}, result: "error", details: { error: msg } });
				outputError(msg, format);
			}
		});
}
