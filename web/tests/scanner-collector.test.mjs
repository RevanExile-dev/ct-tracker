import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual TS ranking/parser in Node; database access is forbidden
// here because these regression cases supply explicit catalog entries.
function loadModule(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => {
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  }});
  return exports;
}
const parser = loadModule('../lib/scanner/collector-number.ts');
const catalog = loadModule('../lib/scanner/catalog.ts', {
  './collector-number': parser, '@/lib/db': {},
});

test('gallery identifiers survive OCR noise, case, spacing and zero padding', () => {
  for (const text of ['TG05/TG30', 'tg05 / tg30', 'TG O5 / TG 3O', 'Pikachu TG05-TG30']) {
    assert.equal(parser.extractCollectorNumber(text), 'TG5/TG30');
  }
  assert.equal(parser.extractCollectorNumber('GG05/GG70'), 'GG5/GG70');
  assert.equal(parser.extractCollectorNumber('SV001/SV122'), 'SV1/SV122');
  assert.equal(parser.extractCollectorNumber('RC01/RC032'), 'RC1/RC32');
});

test('numeric regressions and malformed prefixes do not become exact evidence', () => {
  assert.equal(parser.extractCollectorNumber('I95/I82'), '195/182');
  assert.equal(parser.extractCollectorNumber('005/030'), '5/30');
  for (const text of ['TG05/GG30', 'TG05/30', 'XX05/XX30', 'XX05/030', 'TG05/TG00', 'TG05']) {
    assert.equal(parser.extractCollectorNumber(text), null, text);
  }
});

test('metadata names and image URLs use the same gallery parser', () => {
  assert.equal(parser.stripCollectorNumbers('Pikachu TG05/TG30'), 'Pikachu  ');
  assert.equal(catalog.collectorNumberFromImageUrl('https://cardtrader.com/uploads/blueprints/image/221649/pikachu-ultra-rare-tg05-tg30-lost-origin.jpg'), 'TG5/TG30');
  assert.equal(catalog.collectorNumberFromImageUrl('https://example.test/blitzle-195-182.jpg'), '195/182');
  assert.equal(catalog.collectorNumberFromImageUrl('https://example.test/pikachu-tg05%2Ftg30.jpg'), 'TG5/TG30');
});

const entry = (id, version, name = 'Pikachu') => ({
  id, name, version, expansion_code: 'lorg', expansion_name: 'Lost Origin',
  image_url: null, rarity: null,
});

test('reported Pikachu beats other Pikachu printings without a visual index', () => {
  const entries = [entry(1, '005/030'), entry(2, 'TG06/TG30'), entry(3, 'GG05/GG30'),
    entry(221649, 'Ultra Rare | TG05/TG30')];
  const ranked = catalog.rankScannerCandidates('Pikachu\nTG O5 / TG 3O\ndebolezza resistenza ritirata', entries);
  assert.equal(ranked[0].id, 221649);
  assert.equal(ranked[0].numberScore, 1);
  assert.equal(ranked[0].nameScore, 1);
  for (const id of [1, 3]) assert.equal(ranked.find(row => row.id === id).numberScore, 0);
});

test('number in name and URL works; ordinary numbers still disambiguate', () => {
  const correct = entry(221649, null, 'Pikachu TG05/TG30');
  assert.equal(catalog.rankScannerCandidates('Pikachu TG05/TG30', [entry(1, 'TG06/TG30'), correct])[0].id, 221649);
  correct.name = 'Pikachu';
  correct.image_url = 'https://example.test/pikachu-tg05-tg30.jpg';
  assert.equal(catalog.rankScannerCandidates('Pikachu TG05/TG30', [entry(1, 'TG06/TG30'), correct])[0].id, 221649);
  assert.equal(catalog.rankScannerCandidates('Blitzle I95/I82', [entry(1, '194/182', 'Blitzle'), entry(2, '195/182', 'Blitzle')])[0].id, 2);
});

test('collector code cannot disambiguate two sets with identical name and code', () => {
  const a = entry(1, 'TG05/TG30');
  const b = { ...entry(2, 'TG05/TG30'), expansion_code: 'other' };
  const ranked = catalog.rankScannerCandidates('Pikachu TG05/TG30', [a, b]);
  assert.equal(ranked[0].score, ranked[1].score);
});
