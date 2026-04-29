/**
 * ZIP utilities for SUNAT submission and CDR parsing.
 *
 * Outbound: pack one signed XML into a ZIP, return base64.
 * Inbound: SUNAT returns base64 ZIP that contains another ZIP (R-{filename}.zip)
 * which contains the CDR XML (R-{filename}.xml).
 */

import yauzl from "yauzl";
import yazl from "yazl";

export async function zipSingleFile(filename: string, content: string): Promise<Buffer> {
	const zipfile = new yazl.ZipFile();
	zipfile.addBuffer(Buffer.from(content, "utf-8"), filename);
	zipfile.end();
	return await streamToBuffer(zipfile.outputStream as unknown as NodeJS.ReadableStream);
}

export async function unzipFirstEntry(buffer: Buffer): Promise<{ filename: string; content: Buffer }> {
	return unzipFirstMatching(buffer, () => true);
}

export async function unzipFirstMatching(
	buffer: Buffer,
	predicate: (filename: string) => boolean,
): Promise<{ filename: string; content: Buffer }> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err || new Error("Empty zip"));
			let resolved = false;
			zipfile.readEntry();
			zipfile.on("entry", (entry) => {
				const isDir = /\/$/.test(entry.fileName);
				if (isDir || !predicate(entry.fileName)) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (err2, stream) => {
					if (err2 || !stream) return reject(err2 || new Error("No stream"));
					streamToBuffer(stream)
						.then((content) => {
							resolved = true;
							resolve({ filename: entry.fileName, content });
						})
						.catch(reject);
				});
			});
			zipfile.on("end", () => {
				if (!resolved) reject(new Error("No matching entry in zip"));
			});
			zipfile.on("error", reject);
		});
	});
}

export async function unzipNested(buffer: Buffer): Promise<{ filename: string; xml: string }> {
	// SUNAT CDR: outer zip contains an inner R-{filename}.zip OR directly R-{filename}.xml.
	// Skip directory entries and pick the first .xml or .zip.
	const outer = await unzipFirstMatching(buffer, (n) => /\.(xml|zip)$/i.test(n));
	if (outer.filename.toLowerCase().endsWith(".xml")) {
		return { filename: outer.filename, xml: outer.content.toString("utf-8") };
	}
	const inner = await unzipFirstMatching(outer.content, (n) => n.toLowerCase().endsWith(".xml"));
	return { filename: inner.filename, xml: inner.content.toString("utf-8") };
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => chunks.push(chunk));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", reject);
	});
}
