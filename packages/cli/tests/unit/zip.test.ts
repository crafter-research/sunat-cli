import { describe, expect, test } from "bun:test";
import { unzipFirstEntry, unzipNested, zipSingleFile } from "../../src/cpe/soap/zip.ts";

describe("zip / unzip roundtrip", () => {
	test("zipSingleFile then unzipFirstEntry returns original content", async () => {
		const original = "<?xml version='1.0'?><root>hola</root>";
		const buffer = await zipSingleFile("test.xml", original);
		const { filename, content } = await unzipFirstEntry(buffer);
		expect(filename).toBe("test.xml");
		expect(content.toString("utf-8")).toBe(original);
	});

	test("unzipNested unwraps zip-in-zip (CDR style)", async () => {
		const xml = "<?xml version='1.0'?><CDR>0000</CDR>";
		const innerZip = await zipSingleFile("R-test.xml", xml);
		const outerZip = await zipSingleFileFromBuffer("R-test.zip", innerZip);
		const result = await unzipNested(outerZip);
		expect(result.filename).toBe("R-test.xml");
		expect(result.xml).toBe(xml);
	});

	test("unzipNested returns directly if outer is XML (single-zip variant)", async () => {
		const xml = "<root>x</root>";
		const buffer = await zipSingleFile("CDR.xml", xml);
		const result = await unzipNested(buffer);
		expect(result.xml).toBe(xml);
	});
});

async function zipSingleFileFromBuffer(filename: string, content: Buffer): Promise<Buffer> {
	const yazl = await import("yazl");
	const zipfile = new yazl.ZipFile();
	zipfile.addBuffer(content, filename);
	zipfile.end();
	const chunks: Buffer[] = [];
	const stream = zipfile.outputStream as unknown as NodeJS.ReadableStream;
	return new Promise((resolve, reject) => {
		stream.on("data", (c: Buffer) => chunks.push(c));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", reject);
	});
}
