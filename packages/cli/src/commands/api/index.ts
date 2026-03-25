import { Command } from "commander";
import { getApiCredentials, getCredentials } from "../../data/config.ts";
import { output, outputError } from "../../utils/output.ts";

const TOKEN_URL = "https://api-seguridad.sunat.gob.pe/v1/clientessol";

export function createApiCommand(): Command {
	const api = new Command("api").description("SUNAT REST API operations");

	api
		.command("token")
		.description("Get or refresh OAuth2 API token")
		.action(async (_, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "auto";
			try {
				const { clientId, clientSecret } = getApiCredentials();
				const { ruc, usuario, password } = getCredentials();

				const response = await fetch(`${TOKEN_URL}/${clientId}/oauth2/token/`, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "password",
						scope: "https://api.sunat.gob.pe/v1/contribuyente/gem",
						client_id: clientId,
						client_secret: clientSecret,
						username: `${ruc}${usuario.toUpperCase()}`,
						password,
					}),
				});

				if (!response.ok) {
					throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
				}

				const data = await response.json();
				output(format, {
					json: {
						accessToken: data.access_token,
						tokenType: data.token_type,
						expiresIn: data.expires_in,
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return api;
}
