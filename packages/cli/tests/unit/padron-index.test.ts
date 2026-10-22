import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("SQLite and streaming agree; stale/corrupt indexes fall back and failed builds preserve the live index", async () => {
	const home = mkdtempSync(join(tmpdir(), "padron-index-"));
	try {
		const module = new URL("../../src/sunat-rest/padron-local.ts", import.meta.url).pathname;
		const script = `
   import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
   import { join } from 'node:path';
   import { lookupRuc, lookupRucBatch, indexPadron, padronIndexStatus, syncPadron } from ${JSON.stringify(module)};
   import assert from 'node:assert/strict';
   const cache = join(process.env.SUNAT_HOME, 'cache');
   mkdirSync(cache, { recursive: true });
   const txt = join(cache, 'padron_reducido_ruc.txt');
   const row = '00000000001|COMPAÑÍA SINTÉTICA|ACTIVO|HABIDO|000000|AV.|FICTICIA|Z|URB|1|2|3|4|5';
   writeFileSync(txt, Buffer.from('RUC|HEADER\\r\\ninvalid\\r\\n00000000001|BROKEN\\r\\n00000000001INVALID\\r\\n' + row + '\\r\\n00000000001|DUPLICATE|BAJA|NO HABIDO\\r\\n00000000002|OTRA FICTICIA|BAJA|NO HABIDO', 'latin1'));
   const rucs = ['00000000001', '00000000002', '00000000003', 'invalid', '00000000001'];
   const expected = await lookupRucBatch(rucs);
   assert.equal((await lookupRuc('00000000001')).razonSocial, 'COMPAÑÍA SINTÉTICA');
   assert.equal(padronIndexStatus().present, false);
   assert.equal((await indexPadron()).entries, 2);
   assert.ok(padronIndexStatus().size > 0);
   assert.deepEqual(await lookupRucBatch(rucs), expected);
   assert.deepEqual(await lookupRuc('00000000002'), expected.get('00000000002'));
   assert.equal(await lookupRuc('00000000003'), null);
   writeFileSync(txt, '00000000001|CHANGED SYNTHETIC|ACTIVO|HABIDO');
   assert.equal((await lookupRuc('00000000001')).razonSocial, 'CHANGED SYNTHETIC');
   await indexPadron();
   const original = readFileSync(join(cache, 'padron.sqlite'));
   // A directory as the TXT makes the streaming build fail after opening SQLite.
   const { rmSync } = await import('node:fs');
   rmSync(txt); mkdirSync(txt);
   await assert.rejects(indexPadron());
   assert.deepEqual(readFileSync(join(cache, 'padron.sqlite')), original);
   assert.equal(readdirSync(cache).some(name => name.endsWith('.tmp') || name.endsWith('-journal')), false);
   rmSync(txt, { recursive: true }); writeFileSync(txt, row, 'latin1');
   writeFileSync(join(cache, 'padron.sqlite'), 'broken');
   assert.equal((await lookupRuc('00000000001')).razonSocial, 'COMPAÑÍA SINTÉTICA');
   assert.deepEqual(await lookupRucBatch(['invalid']), new Map());
   await indexPadron();
   // A source replacement while the runtime opens SQLite must abort publication.
   const live = readFileSync(join(cache, 'padron.sqlite'));
   const changing = indexPadron();
   writeFileSync(txt, row + '\\n00000000002|NEW SYNTHETIC|ACTIVO|HABIDO', 'latin1');
   await assert.rejects(changing, /changed during indexing/);
   assert.deepEqual(readFileSync(join(cache, 'padron.sqlite')), live);
   assert.equal(readdirSync(cache).some(name => name.endsWith('.tmp') || name.endsWith('-journal')), false);
   // Independent builders must not share staging files or damage the live DB.
   await Promise.all([indexPadron(), indexPadron()]);
   assert.equal((await lookupRuc('00000000002')).razonSocial, 'NEW SYNTHETIC');
   assert.equal(readdirSync(cache).some(name => name.endsWith('.tmp') || name.endsWith('-journal')), false);
   const { ZipFile } = await import('yazl');
   const zip = new ZipFile();
   zip.addBuffer(Buffer.from('00000000001|SYNCED SYNTHETIC|ACTIVO|HABIDO', 'latin1'), 'padron.txt');
   zip.end();
   const chunks = [];
   for await (const chunk of zip.outputStream) chunks.push(chunk);
   globalThis.fetch = async () => new Response(Buffer.concat(chunks));
   await syncPadron({ force: true });
   assert.equal(padronIndexStatus().present, false);
   assert.equal((await lookupRuc('00000000001')).razonSocial, 'SYNCED SYNTHETIC');
   await indexPadron();
   globalThis.fetch = async () => new Response('synthetic invalid ZIP');
   await assert.rejects(syncPadron({ force: true }));
   assert.equal(padronIndexStatus().present, false);
   assert.equal((await lookupRuc('00000000001')).razonSocial, 'SYNCED SYNTHETIC');
  `;
		const proc = Bun.spawn([process.env.PADRON_TEST_RUNTIME || process.execPath, "-e", script], {
			env: { ...process.env, SUNAT_HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited, stderr).toBe(0);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
