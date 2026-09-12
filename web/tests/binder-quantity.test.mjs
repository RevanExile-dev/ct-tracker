import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => store.clear(),
    _store: store,
  };
}

function loadBinderModule() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/binder.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localStorage = fakeLocalStorage();
  const context = { exports, window: {}, localStorage, fetch: () => Promise.reject(new Error('no network in tests')) };
  vm.runInNewContext(code, context);
  return { module: exports, localStorage };
}

test('a corrupted quantity in storage resets to 1 without dropping the owned card', () => {
  const { module, localStorage } = loadBinderModule();
  localStorage.setItem('ct-tracker:binder:v2', JSON.stringify([
    { blueprintId: 1, language: null, quantity: 'banana', finish: 'unknown', addedAt: '2026-09-01' },
    { blueprintId: 2, language: null, quantity: -5, finish: 'unknown', addedAt: '2026-09-01' },
    { blueprintId: 3, language: null, quantity: 3.5, finish: 'unknown', addedAt: '2026-09-01' },
    { blueprintId: 4, language: null, quantity: 2, finish: 'unknown', addedAt: '2026-09-01' },
  ]));
  const entries = module.getBinderEntries();
  assert.equal(entries.length, 4, 'nessuna carta scartata per una quantita\' corrotta');
  const byId = new Map(entries.map((e) => [e.blueprintId, e.quantity]));
  assert.equal(byId.get(1), 1);
  assert.equal(byId.get(2), 1);
  assert.equal(byId.get(3), 1);
  assert.equal(byId.get(4), 2, 'una quantita\' gia\' valida non viene toccata');
});

test('upsertBinderEntry clamps an out-of-range quantity on both create and update', () => {
  const { module } = loadBinderModule();
  const created = module.upsertBinderEntry(10, { quantity: -3 });
  assert.equal(created.find((e) => e.blueprintId === 10).quantity, 1, 'quantita\' negativa alla creazione -> 1');

  module.upsertBinderEntry(11, { quantity: 5 });
  const updated = module.upsertBinderEntry(11, { quantity: 1000 });
  assert.equal(updated.find((e) => e.blueprintId === 11).quantity, 1, 'quantita\' oltre il limite in un update -> 1 (mai propagata cosi\' com\'e\')');
});

test('setBinderQuantity changes quantity only for a card already in the binder', () => {
  const { module } = loadBinderModule();
  const beforeAdd = module.setBinderQuantity(20, 5);
  assert.equal(beforeAdd.length, 0, 'nessun effetto collaterale: non aggiunge una carta assente');

  module.toggleBinder(20);
  const after = module.setBinderQuantity(20, 5);
  assert.equal(after.find((e) => e.blueprintId === 20).quantity, 5);
});

test('a quantity change never touches the price/profile fields of the same entry', () => {
  const { module } = loadBinderModule();
  module.upsertBinderEntry(30, { language: 'it', condition: 'Near Mint', finish: 'foil', quantity: 1 });
  const after = module.setBinderQuantity(30, 4);
  const entry = after.find((e) => e.blueprintId === 30);
  assert.equal(entry.quantity, 4);
  assert.equal(entry.language, 'it');
  assert.equal(entry.condition, 'Near Mint');
  assert.equal(entry.finish, 'foil');
});
