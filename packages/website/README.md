# sunat-cli website

Static Astro site for [sunat-cli.crafter.ing](https://sunat-cli.crafter.ing).

```sh
bun install
bun dev       # localhost:4321
bun run build # -> dist/
```

## Design system

The site has no CSS framework. Everything comes from three files:

| File | Owns |
| --- | --- |
| `src/styles/tokens.css` | Colour, type scale, spacing, fonts. Light is the base; dark is redefined under both `prefers-color-scheme` and `[data-theme="dark"]`. |
| `src/styles/base.css` | Reset, shell grid, section rhythm, the full-bleed hairline grid. |
| `src/lib/code-theme.ts` | The two Shiki themes. |

### Themes

Three states: `light`, `dark`, `system`. System is the default and stores
nothing, so `prefers-color-scheme` decides. An explicit choice writes
`data-theme` on `<html>` and persists to `localStorage` under `sunat-theme`.
An inline script in `src/layouts/Base.astro` applies the stored value before
first paint, so a reload never flashes the other theme.

Every colour pair in `tokens.css` was measured against WCAG AA at its
intended size before it shipped. Changing one means re-measuring it.

### Code blocks

Snippets render once through Shiki with `themes: { light, dark }` and
`defaultColor: false`, which emits `--shiki-light` / `--shiki-dark` on every
token. One block in the DOM serves both themes; the CSS in `index.astro`
picks the side.

The scopes in `code-theme.ts` are the ones the bash grammar actually emits,
read off `codeToTokens(..., { includeExplanation: true })`. A shell argument
is `string.unquoted.argument.shell` and a flag is
`constant.other.option.dash.shell`. Targeting the generic `keyword` scope,
which most TextMate themes lean on, colours nothing in a shell transcript.

### Fonts

Geist Sans, Geist Mono, and Geist Pixel are vendored as woff2 in
`public/fonts/` from the `geist` npm package. The package ships them wired
for `next/font/local`, which Astro does not use, so `tokens.css` declares
`@font-face` directly.

Geist Pixel only has glyphs for lowercase letters; digits and capitals fall
back to Geist Mono. That is why it is used for the wordmark and nothing else.

## Languages

Spanish is the default and lives at the root; English is under `/en`. The
product only works in Peru, so the person filing an F616 is the primary
reader and gets the unprefixed URL.

| Route | Language |
| --- | --- |
| `/` and `/legal` | Spanish |
| `/en` and `/en/legal` | English |

Routing is Astro's built-in i18n with `prefixDefaultLocale: false`. Both
routes render the same `Home.astro` and `Legal.astro`, parameterised by
locale, so a structural change lands in both at once.

### Detection

The site is static, so no request header is available and
`Astro.preferredLocale` does not apply. An inline script in `Base.astro`
reads `navigator.languages` instead, which reports what someone reads
rather than where they are.

The rules, in order:

1. A URL that names its language (`/en/...`) is never redirected away
   from. A shared link has to survive being opened by someone whose own
   preference differs.
2. On an unprefixed URL, a stored choice under `sunat-lang` wins.
3. Otherwise an English-first browser goes to `/en`. Everything else,
   including any Spanish variant and any unrecognised language, stays on
   the Spanish default.

Clicking the language switcher records the choice, so detection never
overrides it afterwards.

## Content

Copy lives in `src/lib/content.ts`, one object per locale rather than a
shared key table. The Spanish is written for a Peruvian taxpayer and uses
SUNAT's own vocabulary; the English explains the domain to someone who has
never filed here. Neither is a translation of the other.

`VERSION` there is maintained by hand and should track
`packages/cli/package.json`.
