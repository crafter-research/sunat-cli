/**
 * OAuth 2.0 client_credentials flow for SUNAT REST APIs.
 *
 * SUNAT exposes two host families:
 *   - api-seguridad.sunat.gob.pe — token endpoint
 *   - api.sunat.gob.pe — operational endpoints (consulta CPE, padron, etc)
 *
 * Tokens last 1 hour. Cached in-process; refreshed on 401 or near-expiry.
 *
 * Credentials (client_id + client_secret) are obtained from SUNAT SOL menu:
 *   Mi RUC y Otros Registros → Apps Móviles → Credenciales API
 */

const SECURITY_BASE = "https://api-seguridad.sunat.gob.pe/v1";
const API_BASE = "https://api.sunat.gob.pe/v1";
const SIRE_BASE = "https://api-sire.sunat.gob.pe/v1";

export interface OAuthCredentials {
	clientId: string;
	clientSecret: string;
	scope?: string;
	/**
	 * SIRE uses password grant (instead of client_credentials) and requires
	 * the RUC + SOL_USER + SOL_PASSWORD on top of the client_id/secret.
	 * When `password` is set, we use the clientessol endpoint variant.
	 */
	username?: string; // {RUC}{SOL_USER} concatenated, e.g. "20131312955MODDATOS"
	password?: string; // SOL password (clave SOL)
}

interface CachedToken {
	accessToken: string;
	expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(clientId: string, scope: string): string {
	return `${clientId}::${scope}`;
}

export const SUNAT_REST_BASES = {
	security: SECURITY_BASE,
	api: API_BASE,
	sire: SIRE_BASE,
} as const;

export const SCOPES = {
	contribuyente: "https://api.sunat.gob.pe/v1/contribuyente/contribuyentes",
	gre: "https://api.sunat.gob.pe/v1/contribuyente/gem/comprobantes",
	sire: "https://api-sire.sunat.gob.pe",
} as const;

export async function getAccessToken(creds: OAuthCredentials): Promise<string> {
	const isPasswordGrant = !!(creds.username && creds.password);
	const scope = creds.scope || (isPasswordGrant ? SCOPES.sire : SCOPES.contribuyente);
	const key = cacheKey(creds.clientId, scope);
	const cached = tokenCache.get(key);

	// Refresh 60s before actual expiry
	if (cached && cached.expiresAt > Date.now() + 60_000) {
		return cached.accessToken;
	}

	const endpoint = isPasswordGrant ? "clientessol" : "clientesextranet";
	const tokenUrl = `${SECURITY_BASE}/${endpoint}/${encodeURIComponent(creds.clientId)}/oauth2/token/`;
	const params: Record<string, string> = {
		grant_type: isPasswordGrant ? "password" : "client_credentials",
		scope,
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
	};
	if (isPasswordGrant) {
		// SIRE-specific: username = "{RUC}{SOL_USER}" + password = SOL password
		params.username = creds.username as string;
		params.password = creds.password as string;
	}
	const body = new URLSearchParams(params);

	const resp = await fetch(tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body,
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`SUNAT OAuth ${resp.status}: ${text.slice(0, 300)}`);
	}

	const json = (await resp.json()) as { access_token: string; token_type: string; expires_in: number };
	if (!json.access_token) throw new Error(`SUNAT OAuth response missing access_token: ${JSON.stringify(json)}`);

	const token: CachedToken = {
		accessToken: json.access_token,
		expiresAt: Date.now() + (json.expires_in - 60) * 1000,
	};
	tokenCache.set(key, token);
	return token.accessToken;
}

export function clearTokenCache(): void {
	tokenCache.clear();
}

export interface RestRequestOptions {
	creds: OAuthCredentials;
	method?: "GET" | "POST" | "PUT" | "DELETE";
	path: string; // path without /v1 prefix, starts with /contribuyente/...
	body?: unknown;
	query?: Record<string, string | number | undefined>;
	/** Override base URL: defaults to api.sunat.gob.pe; use "sire" for api-sire. */
	baseHost?: "api" | "sire";
}

export async function callRestApi<T = unknown>(opts: RestRequestOptions): Promise<T> {
	const token = await getAccessToken(opts.creds);
	const base = opts.baseHost === "sire" ? SIRE_BASE : API_BASE;
	const url = new URL(`${base}${opts.path}`);
	if (opts.query) {
		for (const [k, v] of Object.entries(opts.query)) {
			if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
		}
	}

	const init: RequestInit = {
		method: opts.method || "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
	};
	if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

	let resp = await fetch(url, init);

	// Refresh on 401 once
	if (resp.status === 401) {
		clearTokenCache();
		const fresh = await getAccessToken(opts.creds);
		(init.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
		resp = await fetch(url, init);
	}

	const text = await resp.text();
	if (!resp.ok) {
		throw new Error(`SUNAT API ${resp.status} on ${opts.path}: ${text.slice(0, 500)}`);
	}

	if (!text) return undefined as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		return text as unknown as T;
	}
}
