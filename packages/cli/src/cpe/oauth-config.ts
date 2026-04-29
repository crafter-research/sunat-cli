/**
 * OAuth credentials for SUNAT REST APIs (consulta CPE, padrón vía API, GRE).
 *
 * Distinct from the cert+SOL-password flow used by sunat-direct (SOAP).
 * These credentials are obtained from SOL menu:
 *   Mi RUC y Otros Registros → Apps Móviles → Credenciales API
 */

import type { OAuthCredentials } from "../sunat-rest/oauth.ts";

export function resolveOAuthCredentials(): OAuthCredentials {
	const clientId = process.env.SUNAT_API_CLIENT_ID;
	const clientSecret = process.env.SUNAT_API_CLIENT_SECRET;
	if (!clientId) throw new Error("SUNAT_API_CLIENT_ID env var missing. Get from SOL → Mi RUC → Credenciales API.");
	if (!clientSecret) throw new Error("SUNAT_API_CLIENT_SECRET env var missing.");
	return { clientId, clientSecret };
}
