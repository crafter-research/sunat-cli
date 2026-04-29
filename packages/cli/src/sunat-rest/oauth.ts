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

export interface OAuthCredentials {
	clientId: string;
	clientSecret: string;
	scope?: string;
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
} as const;

export const SCOPES = {
	contribuyente: "https://api.sunat.gob.pe/v1/contribuyente/contribuyentes",
	gre: "https://api.sunat.gob.pe/v1/contribuyente/gem/comprobantes",
} as const;

export async function getAccessToken(creds: OAuthCredentials): Promise<string> {
	const scope = creds.scope || SCOPES.contribuyente;
	const key = cacheKey(creds.clientId, scope);
	const cached = tokenCache.get(key);

	// Refresh 60s before actual expiry
	if (cached && cached.expiresAt > Date.now() + 60_000) {
		return cached.accessToken;
	}

	const tokenUrl = `${SECURITY_BASE}/clientesextranet/${encodeURIComponent(creds.clientId)}/oauth2/token/`;
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		scope,
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
	});

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
}

export async function callRestApi<T = unknown>(opts: RestRequestOptions): Promise<T> {
	const token = await getAccessToken(opts.creds);
	const url = new URL(`${API_BASE}${opts.path}`);
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
