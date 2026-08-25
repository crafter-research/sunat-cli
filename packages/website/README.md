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

## Content

Copy, coverage figures, and the roadmap live in `src/lib/content.ts`.
`VERSION` there is maintained by hand and should track
`packages/cli/package.json`.
