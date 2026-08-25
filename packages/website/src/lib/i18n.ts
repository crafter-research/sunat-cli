export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

export function isLocale(v: string | undefined): v is Locale {
	return v === "es" || v === "en";
}

/**
 * Prefix a path for a locale. Spanish is the default and sits at the root, so
 * it never takes a prefix; English always does.
 */
export function localePath(locale: Locale, path = "/"): string {
	const clean = path.startsWith("/") ? path : `/${path}`;
	if (locale === DEFAULT_LOCALE) return clean;
	return clean === "/" ? "/en" : `/en${clean}`;
}

/** The same page in the other language, for the switcher and for hreflang. */
export function altPath(locale: Locale, path = "/"): string {
	return localePath(locale === "es" ? "en" : "es", path);
}
