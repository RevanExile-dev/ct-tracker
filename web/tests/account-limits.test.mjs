import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// accountLimits.ts non ha import: si carica da solo, senza database.
function loadLimits() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/accountLimits.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}

const L = loadLimits();

test('i tetti stanno ben sopra l\'uso reale piu\' alto letto il 2026-10-09', () => {
  assert.ok(L.MAX_BINDER_CARDS >= 152 * 10);
  assert.ok(L.MAX_WISHLIST_CARDS >= 74 * 10);
  assert.ok(L.MAX_LOTS >= 98 * 10);
  assert.ok(L.MAX_PRICE_ALERTS >= 27 * 3);
});

test('exceedsLimit blocca solo l\'aggiunta oltre il tetto', () => {
  assert.equal(L.exceedsLimit(99, 1, 100), false);
  assert.equal(L.exceedsLimit(100, 1, 100), true);
  assert.equal(L.exceedsLimit(98, 3, 100), true);
});

test('chi e\' gia\' oltre il tetto non perde nulla: senza righe nuove non scatta mai', () => {
  assert.equal(L.exceedsLimit(250, 0, 100), false);
  assert.equal(L.exceedsLimit(250, -2, 100), false);
});

test('isValidBlueprintId accetta solo interi positivi da INTEGER Postgres', () => {
  for (const ok of [1, 402962, 2147483647]) assert.equal(L.isValidBlueprintId(ok), true);
  for (const bad of [0, -1, 1.5, NaN, Infinity, 2147483648, '12', null, undefined]) assert.equal(L.isValidBlueprintId(bad), false);
});

test('pickBinderPatch tiene solo lingua/quantita/condizione/finitura e scarta il resto', () => {
  const r = L.pickBinderPatch({ language: 'Italiano', quantity: 2, condition: 'NM', finish: 'holo', addedAt: '2026-01-01', evil: 'x'.repeat(10000) });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { patch: { language: 'Italiano', condition: 'NM', finish: 'holo', quantity: 2 } });
});

test('pickBinderPatch: patch vuoto o non oggetto -> nessun campo (come prima)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(L.pickBinderPatch({}))), { patch: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(L.pickBinderPatch(null))), { patch: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(L.pickBinderPatch([1, 2]))), { patch: {} });
});

test('pickBinderPatch: language null ammesso (scanner), testo troppo lungo rifiutato', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(L.pickBinderPatch({ language: null }))), { patch: { language: null } });
  assert.ok('error' in L.pickBinderPatch({ language: 'x'.repeat(41) }));
  assert.ok('error' in L.pickBinderPatch({ finish: 5 }));
});

test('nome e dimensione del filtro salvato', () => {
  assert.equal(L.isValidPresetScope('catalog'), true);
  assert.equal(L.isValidPresetScope(''), false);
  assert.equal(L.isValidPresetScope('a/b'), false);
  assert.equal(L.isValidPresetScope('x'.repeat(41)), false);
  assert.equal(L.isValidPresetSize({ search: 'mew', rarities: ['Rare'] }), true);
  assert.equal(L.isValidPresetSize({ junk: 'x'.repeat(9000) }), false);
});

test('AccountLimitError porta il messaggio in italiano con il numero formattato', () => {
  const err = new L.AccountLimitError(L.limitMessage('allarmi prezzo', 100));
  assert.equal(err.name, 'AccountLimitError');
  assert.match(err.message, /massimo di 100 allarmi prezzo/);
});
