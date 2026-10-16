import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, context = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, Intl, ...context });
  return exports;
}

test('normalizeRarity riconduce i nomi abbreviati e con refuso alla rarità canonica', () => {
  const { normalizeRarity } = load('../lib/rarity.ts');

  assert.equal(normalizeRarity('Special Illustration'), 'Special Illustration Rare');
  assert.equal(normalizeRarity('Special Illustraion Rare'), 'Special Illustration Rare');
  assert.equal(normalizeRarity('Special Illustration Rare'), 'Special Illustration Rare');
  assert.equal(normalizeRarity('Rare Holo'), 'Rare Holo');
});

test('expandRarityFilters espande la rarità canonica nei suoi alias', () => {
  const { expandRarityFilters } = load('../lib/rarity.ts');

  const aliases = JSON.parse(JSON.stringify(
    expandRarityFilters(['Special Illustration Rare']).sort(),
  ));
  assert.deepEqual(aliases, [
    'Special Illustraion Rare',
    'Special Illustration',
    'Special Illustration Rare',
  ]);

  const aliasesDaAbbreviato = JSON.parse(JSON.stringify(
    expandRarityFilters(['Special Illustration']).sort(),
  ));
  assert.deepEqual(aliasesDaAbbreviato, [
    'Special Illustraion Rare',
    'Special Illustration',
    'Special Illustration Rare',
  ]);
});

test('expandRarityFilters rimuove i duplicati e restituisce una lista vuota per input vuoto', () => {
  const { expandRarityFilters } = load('../lib/rarity.ts');

  const senzaDuplicati = JSON.parse(JSON.stringify(expandRarityFilters(['Rare Holo', 'Rare Holo'])));
  assert.deepEqual(senzaDuplicati, ['Rare Holo']);

  const vuota = JSON.parse(JSON.stringify(expandRarityFilters([])));
  assert.deepEqual(vuota, []);
});
