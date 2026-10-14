import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, Intl });
  return exports;
}

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const snap = (n, cents) => ({ captured_at: day(n), min_price_cents: cents, best_price_cents: cents });

test('"vs media" non appare con meno di 3 rilevazioni (la media sarebbe solo il prezzo di ieri)', () => {
  const { trendVsMovingAverage, MIN_TREND_POINTS } = load('../lib/format.ts');
  assert.equal(MIN_TREND_POINTS, 3);
  assert.equal(trendVsMovingAverage([snap(1, 100)], 100, 30), null);
  assert.equal(trendVsMovingAverage([snap(2, 100), snap(1, 100)], 100, 30), null);
});

test('con 3 rilevazioni la variazione vs media viene calcolata', () => {
  const { trendVsMovingAverage } = load('../lib/format.ts');
  const t = trendVsMovingAverage([snap(3, 100), snap(2, 100), snap(1, 100)], 150, 30);
  assert.equal(t.avgCents, 100);
  assert.equal(Math.round(t.deltaPct), 50);
  assert.equal(t.days, 30);
});
