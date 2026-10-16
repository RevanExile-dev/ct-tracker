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

test('PRICE_BANDS ha 5 fasce con le chiavi previste, nell’ordine corretto', () => {
  const { PRICE_BANDS } = load('../lib/priceBands.ts');
  assert.equal(PRICE_BANDS.length, 5);
  assert.deepEqual(
    PRICE_BANDS.map((band) => band.key),
    ['0-1', '1-5', '5-20', '20-100', '100-'],
  );
});

test('Le fasce di prezzo sono contigue e senza buchi', () => {
  const { PRICE_BANDS } = load('../lib/priceBands.ts');
  assert.equal(PRICE_BANDS[0].minCents, undefined);
  assert.equal(PRICE_BANDS.at(-1).maxCents, undefined);

  for (let i = 0; i < PRICE_BANDS.length - 1; i += 1) {
    assert.equal(PRICE_BANDS[i].maxCents, PRICE_BANDS[i + 1].minCents);
  }
});

test('priceBandRange("5-20") restituisce gli estremi in centesimi', () => {
  const { priceBandRange } = load('../lib/priceBands.ts');
  const range = JSON.parse(JSON.stringify(priceBandRange('5-20')));
  assert.deepEqual(range, { minPriceCents: 500, maxPriceCents: 2000 });
});

test('Le fasce aperte restituiscono solo l’estremo definito', () => {
  const { priceBandRange } = load('../lib/priceBands.ts');

  const finoAUnEuro = JSON.parse(JSON.stringify(priceBandRange('0-1')));
  assert.equal(finoAUnEuro.minPriceCents, undefined);
  assert.equal(finoAUnEuro.maxPriceCents, 100);

  const oltreCento = JSON.parse(JSON.stringify(priceBandRange('100-')));
  assert.equal(oltreCento.minPriceCents, 10000);
  assert.equal(oltreCento.maxPriceCents, undefined);
});

test('Chiavi inesistenti, null, undefined e stringa vuota non restituiscono fasce', () => {
  const { priceBandByKey, priceBandRange } = load('../lib/priceBands.ts');

  for (const key of ['inesistente', null, undefined, '']) {
    assert.equal(priceBandByKey(key), undefined);

    const range = JSON.parse(JSON.stringify(priceBandRange(key)));
    assert.deepEqual(range, {});
  }
});
