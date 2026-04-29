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
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err || new Error("Empty zip"));
			zipfile.readEntry();
			zipfile.on("entry", (entry) => {
				zipfile.openReadStream(entry, (err2, stream) => {
					if (err2 || !stream) return reject(err2 || new Error("No stream"));
					streamToBuffer(stream)
						.then((content) => resolve({ filename: entry.fileName, content }))
						.catch(reject);
				});
			});
			zipfile.on("end", () => reject(new Error("Zip is empty")));
			zipfile.on("error", reject);
		});
	});
}

export async function unzipNested(buffer: Buffer): Promise<{ filename: string; xml: string }> {
	const outer = await unzipFirstEntry(buffer);
	if (outer.filename.toLowerCase().endsWith(".xml")) {
		return { filename: outer.filename, xml: outer.content.toString("utf-8") };
	}
	const inner = await unzipFirstEntry(outer.content);
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
