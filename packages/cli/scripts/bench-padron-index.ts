/** Offline synthetic benchmark; never reads the operator's SUNAT cache. */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "padron-bench-"));
process.env.SUNAT_HOME = home;
try {
	const { lookupRucBatch, indexPadron } = await import("../src/sunat-rest/padron-local.ts");
	const cache = join(home, "cache");
	mkdirSync(cache);
	const txt = join(cache, "padron_reducido_ruc.txt");
	const rows = Number(process.env.PADRON_BENCH_ROWS || 100000);
	const namePadding = Number(process.env.PADRON_BENCH_NAME_PADDING || 0);
	if (!Number.isSafeInteger(rows) || rows < 1000 || !Number.isSafeInteger(namePadding) || namePadding < 0)
		throw new Error("Expected PADRON_BENCH_ROWS >= 1000 and PADRON_BENCH_NAME_PADDING >= 0");
	// Bound fixture generation memory even for representative gigabyte-sized input.
	for (let start = 0; start < rows; start += 1000) {
		const block = Array.from({ length: Math.min(1000, rows - start) }, (_, offset) => {
			const i = start + offset;
			return `${String(i).padStart(11, "0")}|SYNTHETIC COMPANY ${i}${"X".repeat(namePadding)}|ACTIVO|HABIDO|000000|AV.|FICTIONAL|||||||\n`;
		}).join("");
		appendFileSync(txt, block, "latin1");
	}
	const rucs = Array.from({ length: 1000 }, (_, i) => String(rows - 1 - i).padStart(11, "0"));
	const measure = async () => {
		const start = performance.now();
		const result = await lookupRucBatch(rucs);
		if (result.size !== 1000 || [...result.values()].some((value) => !value))
			throw new Error("Incomplete benchmark results");
		return performance.now() - start;
	};
	const streamingMs = await measure();
	const start = performance.now();
	const index = await indexPadron();
	const buildMs = performance.now() - start;
	const indexedMs = [];
	for (let i = 0; i < 5; i++) indexedMs.push(await measure());
	console.log(
		JSON.stringify(
			{
				synthetic: true,
				runtime: typeof Bun !== "undefined" ? `Bun ${Bun.version}` : `Node ${process.version}`,
				platform: `${process.platform}/${process.arch}`,
				rows,
				namePadding,
				txtBytes: statSync(txt).size,
				indexBytes: index.size,
				batchSize: rucs.length,
				streamingMs,
				buildMs,
				indexedMs,
				caveat: "Synthetic rows; warm OS cache; not the full SUNAT dataset or a production performance guarantee",
			},
			null,
			2,
		),
	);
} finally {
	rmSync(home, { recursive: true, force: true });
}
