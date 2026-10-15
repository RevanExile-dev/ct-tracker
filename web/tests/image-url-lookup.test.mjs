import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/imageUrlLookup.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, Map, Promise, Date, Number });
  return exports;
}

const { createImageUrlLookup } = load();

function setup(rows) {
  let t = 0;
  const calls = { n: 0, fail: false };
  const lookup = createImageUrlLookup(
    async () => {
      calls.n += 1;
      if (calls.fail) throw new Error('db giu');
      return rows;
    },
    { now: () => t }
  );
  return { lookup, calls, tick: (ms) => { t += ms; } };
}

test('molti id diversi = una sola lettura del database', async () => {
  const { lookup, calls } = setup([{ id: 1, image_url: 'https://a/1.jpg' }, { id: 2, image_url: 'https://a/2.jpg' }]);
  const out = await Promise.all([1, 2, 1, 2].map((id) => lookup(id)));
  assert.deepEqual(out, ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/1.jpg', 'https://a/2.jpg']);
  assert.equal(calls.n, 1);
});

test('id sconosciuto: nessuna rilettura prima di 5 minuti, poi al massimo una', async () => {
  const { lookup, calls, tick } = setup([{ id: 1, image_url: 'https://a/1.jpg' }]);
  await lookup(1);
  for (let id = 100; id < 200; id += 1) assert.equal(await lookup(id), null);
  assert.equal(calls.n, 1);
  tick(5 * 60 * 1000 + 1);
  for (let id = 100; id < 200; id += 1) assert.equal(await lookup(id), null);
  assert.equal(calls.n, 2);
});

test('dopo un\'ora rilegge; se il database e\' giu usa l\'elenco vecchio', async () => {
  const { lookup, calls, tick } = setup([{ id: 1, image_url: 'https://a/1.jpg' }]);
  await lookup(1);
  tick(60 * 60 * 1000 + 1);
  calls.fail = true;
  assert.equal(await lookup(1), 'https://a/1.jpg');
  assert.equal(calls.n, 2);
});

test('senza elenco e database giu: l\'errore arriva alla route', async () => {
  const { lookup, calls } = setup([]);
  calls.fail = true;
  await assert.rejects(lookup(1), /db giu/);
});

test('righe senza image_url sono ignorate', async () => {
  const { lookup } = setup([{ id: 3, image_url: null }]);
  assert.equal(await lookup(3), null);
});
