import sharp from "sharp";
import { writeFileSync } from "fs";
import { join } from "path";

const OUT = join(import.meta.dir, "..", "public");

const BLUE = "#1A3567";
const RED = "#C41E3A";
const WHITE = "#FFFFFF";
const GRAY = "#F5F5F5";

function ogSvg(width: number, height: number): Buffer {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
		<rect width="${width}" height="${height}" fill="${WHITE}"/>
		<rect x="0" y="0" width="${width}" height="6" fill="${RED}"/>
		<rect x="0" y="${height - 80}" width="${width}" height="80" fill="${BLUE}"/>

		<text x="80" y="${height / 2 - 40}" font-family="system-ui, -apple-system, sans-serif" font-size="72" font-weight="700" fill="${BLUE}">
			sunat<tspan fill="${RED}">/</tspan>cli
		</text>

		<text x="80" y="${height / 2 + 20}" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="#4B5563">
			Agent-First Tax Automation for Peru
		</text>

		<text x="80" y="${height - 30}" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500" fill="${WHITE}" opacity="0.7">
			crafter station — gov-tech
		</text>

		<text x="${width - 80}" y="${height - 30}" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500" fill="${WHITE}" opacity="0.7" text-anchor="end">
			sunat-cli.crafter.ing
		</text>
	</svg>`;
	return Buffer.from(svg);
}

function faviconSvg(size: number): Buffer {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
		<rect width="${size}" height="${size}" rx="${size * 0.2}" fill="${BLUE}"/>
		<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="${size * 0.45}" font-weight="700" fill="${WHITE}">
			S<tspan fill="${RED}">/</tspan>
		</text>
	</svg>`;
	return Buffer.from(svg);
}

async function main() {
	// OG Image (1200x630)
	await sharp(ogSvg(1200, 630)).png().toFile(join(OUT, "og.png"));
	console.log("  og.png (1200x630)");

	// Twitter OG (1200x600)
	await sharp(ogSvg(1200, 600)).png().toFile(join(OUT, "og-twitter.png"));
	console.log("  og-twitter.png (1200x600)");

	// Favicon SVG
	writeFileSync(join(OUT, "favicon.svg"), faviconSvg(32).toString());
	console.log("  favicon.svg");

	// Favicon ICO (multi-size)
	const sizes = [16, 32, 48];
	const buffers = await Promise.all(
		sizes.map((s) => sharp(faviconSvg(s)).resize(s, s).png().toBuffer()),
	);

	// ICO format: header + entries + image data
	const ico = buildIco(buffers, sizes);
	writeFileSync(join(OUT, "favicon.ico"), ico);
	console.log("  favicon.ico (16/32/48)");

	console.log("\n  All assets saved to packages/website/public/");
}

function buildIco(pngs: Buffer[], sizes: number[]): Buffer {
	const headerSize = 6;
	const entrySize = 16;
	const entriesSize = entrySize * pngs.length;
	let offset = headerSize + entriesSize;

	const header = Buffer.alloc(headerSize);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // ICO type
	header.writeUInt16LE(pngs.length, 4); // count

	const entries = Buffer.alloc(entriesSize);
	for (let i = 0; i < pngs.length; i++) {
		const pos = i * entrySize;
		entries.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], pos); // width
		entries.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], pos + 1); // height
		entries.writeUInt8(0, pos + 2); // color palette
		entries.writeUInt8(0, pos + 3); // reserved
		entries.writeUInt16LE(1, pos + 4); // color planes
		entries.writeUInt16LE(32, pos + 6); // bits per pixel
		entries.writeUInt32LE(pngs[i].length, pos + 8); // size
		entries.writeUInt32LE(offset, pos + 12); // offset
		offset += pngs[i].length;
	}

	return Buffer.concat([header, entries, ...pngs]);
}

main().catch(console.error);
