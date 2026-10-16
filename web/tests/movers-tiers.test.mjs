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

test('MOVERS_TIERS ha 5 fasce con le chiavi previste, nell’ordine corretto', () => {
  const { MOVERS_TIERS } = load('../lib/moversTiers.ts');

  assert.equal(MOVERS_TIERS.length, 5);
  const chiavi = JSON.parse(JSON.stringify(MOVERS_TIERS.map((tier) => tier.key)));
  assert.deepEqual(chiavi, ['0-5', '5-20', '20-50', '50-150', '150+']);
});

test('Le fasce dei movimenti sono contigue, senza buchi né sovrapposizioni', () => {
  const { MOVERS_TIERS } = load('../lib/moversTiers.ts');

  assert.equal(MOVERS_TIERS[0].minCents, 0);
  assert.equal(MOVERS_TIERS.at(-1).maxCents, null);

  for (let i = 0; i < MOVERS_TIERS.length - 1; i += 1) {
    assert.equal(MOVERS_TIERS[i + 1].minCents, MOVERS_TIERS[i].maxCents + 1);
  }
});

test('findMoversTier restituisce la fascia richiesta oppure undefined', () => {
  const { findMoversTier } = load('../lib/moversTiers.ts');

  const fascia = JSON.parse(JSON.stringify(findMoversTier('5-20')));
  assert.equal(fascia.minCents, 500);
  assert.equal(fascia.maxCents, 1999);

  assert.equal(findMoversTier(null), undefined);
  assert.equal(findMoversTier(''), undefined);
  assert.equal(findMoversTier('inesistente'), undefined);
});

test('Ogni prezzo al confine esatto cade in una sola fascia', () => {
  const { MOVERS_TIERS } = load('../lib/moversTiers.ts');

  for (const prezzo of [500, 2000, 15000]) {
    const fasce = MOVERS_TIERS.filter(
      (tier) => tier.minCents <= prezzo && (tier.maxCents === null || prezzo <= tier.maxCents),
    );
    assert.equal(fasce.length, 1);
  }
});
