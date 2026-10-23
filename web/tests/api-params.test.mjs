import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}

const { parseCardsFilterOpts, parsePageNumber } = load('../lib/apiParams.ts', {
  './accountLimits': load('../lib/accountLimits.ts'),
});
const { MOVERS_PAGE_SIZE } = load('../lib/types.ts');
const opts = (query) => parseCardsFilterOpts(new URLSearchParams(query));
const ids = (query) => Array.from(opts(query).ids);

test('absent ID filter stays undefined, including unflagged IDs', () => {
  for (const query of ['', 'ids=1', 'idsProvided=0&ids=1']) {
    assert.equal(opts(query).ids, undefined, query);
  }
});

test('explicit empty or entirely invalid ID filter remains empty', () => {
  for (const query of ['idsProvided=1', 'idsProvided=1&ids=', 'idsProvided=1&ids=nope&ids=0&ids=-1&ids=1.5&ids=Infinity&ids=2147483648']) {
    assert.deepEqual(ids(query), [], query);
  }
});

test('ID filtering keeps valid IDs, duplicate order and Postgres INTEGER boundaries', () => {
  assert.deepEqual(ids('idsProvided=1&ids=1&ids=nope&ids=127433&ids=1&ids=2147483647&ids=2147483648'), [1, 127433, 1, 2147483647]);
  assert.deepEqual(ids('idsProvided=1&ids=1e2&ids=%20%202%20&ids=0x10'), [100, 2, 16]);
});

test('valid catalog filters retain their existing values', () => {
  const result = opts('search=Pikachu&exactName=1&expansionCode=SLG&rarities=Rare&rarities=Holo&artists=Artist&languages=Italian&conditions=Near+Mint&onlyZero=1&onlyPremium=1&minPriceCents=10.8&maxPriceCents=200');
  assert.equal(result.search, 'Pikachu');
  assert.equal(result.exactName, true);
  assert.equal(result.expansionCode, 'SLG');
  assert.deepEqual(Array.from(result.rarities), ['Rare', 'Holo']);
  assert.deepEqual(Array.from(result.artists), ['Artist']);
  assert.deepEqual(Array.from(result.languages), ['Italian']);
  assert.deepEqual(Array.from(result.conditions), ['Near Mint']);
  assert.equal(result.onlyZero, true);
  assert.equal(result.onlyPremium, true);
  assert.equal(result.minPriceCents, 10);
  assert.equal(result.maxPriceCents, 200);
});

test('missing, malformed, decimal and unsafe pages fall back to page one', () => {
  for (const raw of [null, '', ' ', 'nope', 'NaN', 'Infinity', '-Infinity', '0', '-1', '1.1', '9007199254740992', '1e30', String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(parsePageNumber(raw, MOVERS_PAGE_SIZE), 1, String(raw));
  }
});

test('valid integer pages remain unchanged, without a product-specific page cap', () => {
  for (const raw of ['1', '2', '0012', '1e6', ' 15 ', '1000000000']) {
    assert.equal(parsePageNumber(raw, MOVERS_PAGE_SIZE), Number(raw), raw);
  }
  const lastExactPage = Math.floor(Number.MAX_SAFE_INTEGER / MOVERS_PAGE_SIZE) + 1;
  assert.equal(parsePageNumber(String(lastExactPage), MOVERS_PAGE_SIZE), lastExactPage);
  assert.equal(parsePageNumber(String(lastExactPage + 1), MOVERS_PAGE_SIZE), 1);
});
