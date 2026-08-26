import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const OUT = join(import.meta.dir, "..", "public");
const FONTS = join(OUT, "fonts");

const GRAPHITE = "#0B0D0C";
const SURFACE = "#14181A";
const BORDER = "#232A2C";
const HAIRLINE = "#171C1E";
const AMBER = "#FFB020";
const AMBER_SOFT = "#FFC457";
const TEXT = "#F4F3F0";
const MUTED = "#A6ADB0";

const pixelFont = readFileSync(join(FONTS, "GeistPixel-Square.woff2")).toString(
	"base64",
);
const sansFont = readFileSync(join(FONTS, "Geist-Variable.woff2")).toString(
	"base64",
);
const monoFont = readFileSync(join(FONTS, "GeistMono-Variable.woff2")).toString(
	"base64",
);

function fontStyles(): string {
	return `<style>
		@font-face { font-family: "Geist Pixel"; src: url(data:font/woff2;base64,${pixelFont}); }
		@font-face { font-family: "Geist"; src: url(data:font/woff2;base64,${sansFont}); }
		@font-face { font-family: "Geist Mono"; src: url(data:font/woff2;base64,${monoFont}); }
	</style>`;
}

function promptMark(
	x: number,
	y: number,
	size: number,
	background = true,
): string {
	const scale = size / 32;
	const tx = (value: number) => x + value * scale;
	const ty = (value: number) => y + value * scale;
	const stroke = 3.25 * scale;
	return `${
		background
			? `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${6 * scale}" fill="${SURFACE}" stroke="${BORDER}" stroke-width="${Math.max(1, scale)}"/>`
			: ""
	}<path d="M ${tx(7)} ${ty(9)} L ${tx(14)} ${ty(16)} L ${tx(7)} ${ty(23)}" fill="none" stroke="${AMBER}" stroke-width="${stroke}" stroke-linecap="square" stroke-linejoin="miter"/><path d="M ${tx(17)} ${ty(23)} H ${tx(25)}" fill="none" stroke="${TEXT}" stroke-width="${stroke}" stroke-linecap="square"/>`;
}

function faviconSvg(size: number): Buffer {
	return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
		<rect width="32" height="32" rx="6" fill="${GRAPHITE}"/>
		<rect x="0.5" y="0.5" width="31" height="31" rx="5.5" fill="none" stroke="${BORDER}"/>
		<path d="M 7 9 L 14 16 L 7 23" fill="none" stroke="${AMBER}" stroke-width="3.25" stroke-linecap="square" stroke-linejoin="miter"/>
		<path d="M 17 23 H 25" fill="none" stroke="${TEXT}" stroke-width="3.25" stroke-linecap="square"/>
	</svg>`);
}

function appIconSvg(size: number): Buffer {
	return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
		<rect width="32" height="32" fill="${GRAPHITE}"/>
		<path d="M 7 9 L 14 16 L 7 23" fill="none" stroke="${AMBER}" stroke-width="3.25" stroke-linecap="square" stroke-linejoin="miter"/>
		<path d="M 17 23 H 25" fill="none" stroke="${TEXT}" stroke-width="3.25" stroke-linecap="square"/>
	</svg>`);
}

function maskIconSvg(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M7 7h4l9 9-9 9H7l9-9z"/><path d="M17 22h9v4h-9z"/></svg>`;
}

function ogSvg(locale: "es" | "en"): Buffer {
	const copy =
		locale === "es"
			? {
					eyebrow: "AUTOMATIZACIÓN TRIBUTARIA / PERÚ",
					lede: "Las superficies de SUNAT en un solo CLI supervisado.",
					preview: "vista previa reconciliada",
				}
			: {
					eyebrow: "TAX AUTOMATION / PERU",
					lede: "SUNAT's surfaces in one supervised CLI.",
					preview: "reconciled preview",
				};

	return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
		${fontStyles()}
		<rect width="1200" height="630" fill="${GRAPHITE}"/>
		<rect width="226" height="630" fill="${SURFACE}"/>
		<path d="M226 0V630M550 0V630M875 0V630" stroke="${HAIRLINE}"/>
		<path d="M0 510H1200" stroke="${BORDER}"/>
		${promptMark(56, 56, 64)}
		<text x="56" y="164" fill="${MUTED}" font-family="Geist Mono, monospace" font-size="18" letter-spacing="1.5">AGENT-FIRST</text>
		<text x="56" y="198" fill="${MUTED}" font-family="Geist Mono, monospace" font-size="18" letter-spacing="1.5">OPEN SOURCE</text>
		<text x="56" y="574" fill="${MUTED}" font-family="Geist Mono, monospace" font-size="15">crafter research</text>
		<text x="294" y="116" fill="${AMBER_SOFT}" font-family="Geist Mono, monospace" font-size="18" letter-spacing="1.6">${copy.eyebrow}</text>
		<text x="294" y="236" fill="${AMBER}" font-family="Geist Pixel, Geist Mono, monospace" font-size="92" letter-spacing="-3">sunat-cli</text>
		<text x="294" y="300" fill="${TEXT}" font-family="Geist, sans-serif" font-size="28">${copy.lede}</text>
		<rect x="294" y="358" width="834" height="116" rx="8" fill="${SURFACE}" stroke="${BORDER}"/>
		<circle cx="326" cy="390" r="5" fill="${AMBER}"/>
		<text x="348" y="397" fill="${MUTED}" font-family="Geist Mono, monospace" font-size="17">RHE / HTTP + DOM</text>
		<text x="326" y="442" fill="${TEXT}" font-family="Geist Mono, monospace" font-size="22"><tspan fill="${AMBER}">$</tspan> sunat-cli rhe emit --preview-only</text>
		<text x="294" y="566" fill="${MUTED}" font-family="Geist Mono, monospace" font-size="16">REST · SOAP · SOL · TUS · OAUTH</text>
		<text x="1128" y="566" fill="${MUTED}" font-family="Geist Mono, monospace" font-size="16" text-anchor="end">${copy.preview}</text>
		<text x="1128" y="598" fill="${AMBER_SOFT}" font-family="Geist Mono, monospace" font-size="16" text-anchor="end">sunat-cli.crafter.ing</text>
	</svg>`);
}

async function main() {
	const ogEs = ogSvg("es");
	const ogEn = ogSvg("en");
	await sharp(ogEs).png().toFile(join(OUT, "og-es.png"));
	await sharp(ogEn).png().toFile(join(OUT, "og-en.png"));
	await sharp(ogEs).png().toFile(join(OUT, "og.png"));
	await sharp(ogEs).png().toFile(join(OUT, "og-twitter.png"));

	writeFileSync(join(OUT, "favicon.svg"), faviconSvg(32).toString());
	writeFileSync(join(OUT, "safari-pinned-tab.svg"), maskIconSvg());

	const sizes = [16, 32, 48];
	const buffers = await Promise.all(
		sizes.map((size) =>
			sharp(faviconSvg(size)).resize(size, size).png().toBuffer(),
		),
	);
	writeFileSync(join(OUT, "favicon.ico"), buildIco(buffers, sizes));

	await sharp(faviconSvg(96))
		.resize(96, 96)
		.png()
		.toFile(join(OUT, "favicon-96x96.png"));
	await sharp(appIconSvg(180))
		.resize(180, 180)
		.png()
		.toFile(join(OUT, "apple-touch-icon.png"));
	await sharp(appIconSvg(192))
		.resize(192, 192)
		.png()
		.toFile(join(OUT, "web-app-manifest-192x192.png"));
	await sharp(appIconSvg(512))
		.resize(512, 512)
		.png()
		.toFile(join(OUT, "web-app-manifest-512x512.png"));

	writeFileSync(
		join(OUT, "site.webmanifest"),
		`${JSON.stringify(
			{
				name: "sunat-cli",
				short_name: "sunat-cli",
				description: "Agent-first tax automation for Peru",
				start_url: "/",
				display: "standalone",
				background_color: GRAPHITE,
				theme_color: GRAPHITE,
				icons: [
					{
						src: "/web-app-manifest-192x192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "any maskable",
					},
					{
						src: "/web-app-manifest-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
			},
			null,
			2,
		)}\n`,
	);
}

function buildIco(pngs: Buffer[], sizes: number[]): Buffer {
	const headerSize = 6;
	const entrySize = 16;
	const entriesSize = entrySize * pngs.length;
	let offset = headerSize + entriesSize;
	const header = Buffer.alloc(headerSize);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	const entries = Buffer.alloc(entriesSize);

	for (let index = 0; index < pngs.length; index++) {
		const position = index * entrySize;
		entries.writeUInt8(sizes[index], position);
		entries.writeUInt8(sizes[index], position + 1);
		entries.writeUInt8(0, position + 2);
		entries.writeUInt8(0, position + 3);
		entries.writeUInt16LE(1, position + 4);
		entries.writeUInt16LE(32, position + 6);
		entries.writeUInt32LE(pngs[index].length, position + 8);
		entries.writeUInt32LE(offset, position + 12);
		offset += pngs[index].length;
	}

	return Buffer.concat([header, entries, ...pngs]);
}

await main();
