import { Command } from "commander";
import { getApiCredentials, getCredentials } from "../../data/config.ts";
import { formatDuration } from "../../utils/dates.ts";
import { isHumanFormat, output, outputError } from "../../utils/output.ts";
import { bold, dim, maskSecret, muted, ok } from "../../utils/style.ts";

const TOKEN_URL = "https://api-seguridad.sunat.gob.pe/v1/clientessol";

/**
 * The question this command answers is "do I have a working token, and for how
 * long", not "show me the credential". The full bearer stays out of the human
 * branch: on a TTY it can be shoulder-surfed or land in a screenshot, and a
 * reader gets nothing from sixty opaque characters that a masked preview does
 * not already give them.
 *
 * Machine mode is unchanged and deliberately carries no token either, which has
 * been the contract since the privacy hardening in #52.
 */
export function renderTokenStatus(status: { tokenType: string; expiresIn: number; preview: string }): string[] {
	return [
		`${ok("●")} API credentials valid  ${muted(`${status.tokenType} token`)}`,
		`  ${dim("expires in")} ${bold(formatDuration(status.expiresIn))}  ${dim(`· ${status.preview}`)}`,
	];
}

export function createApiCommand(): Command {
	const api = new Command("api").description("SUNAT REST API operations");

	api
		.command("token")
		.description("Validate OAuth2 API credentials without printing the token")
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
					throw new Error(`Token request failed with HTTP ${response.status}`);
				}

				const data = await response.json();
				if (!data.access_token) throw new Error("Token response did not contain an access token.");

				const json = { authenticated: true, tokenType: data.token_type, expiresIn: data.expires_in };
				if (!isHumanFormat(format)) {
					output("json", { json });
					return;
				}
				for (const line of renderTokenStatus({
					tokenType: data.token_type,
					expiresIn: data.expires_in,
					preview: maskSecret(String(data.access_token)),
				})) {
					console.log(line);
				}
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return api;
}
