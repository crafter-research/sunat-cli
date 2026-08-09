import { ensureNuevaPlataformaAndF616 } from "../workflows/f616.ts";
import { captureIdCacheFromSession, hasFreshToken, storeIdCache } from "./session.ts";

/**
 * Guarantee a fresh Nueva Plataforma token, opening the browser only when the
 * cached one is missing or within 60s of expiry.
 *
 * The token acquisition is the one step that needs the browser: SUNAT mints the
 * IdCache during the authorization_code login. Once captured it is reused
 * headless for its full hour, so this runs at most once per hour of work.
 */
export async function ensurePlataformaToken(): Promise<void> {
	if (hasFreshToken()) return;
	// Navigating into the F616 form is what makes SUNAT emit the idCache on the
	// servletAcceso request, which the session's network log then holds.
	await ensureNuevaPlataformaAndF616();
	const idCache = await captureIdCacheFromSession();
	storeIdCache(idCache);
}
