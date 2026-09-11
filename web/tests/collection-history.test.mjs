import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../lib/collectionHistory.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, { exports });
const { normalizeCollectionHistory, historyInRange, collectionHistoryCsv } = exports;
const point = (date, value = 10000) => ({ captured_at: date, total_cents: value, currency: 'EUR', cards_count: 5, priced_count: 4 });

test('history sorts actual observations and deduplicates daily snapshots, without inventing missing days', () => {
  const result = normalizeCollectionHistory([point('2026-09-10', 12000), point('2026-09-01'), point('2026-09-10', 13000)]);
  assert.equal(JSON.stringify(result), JSON.stringify([point('2026-09-01'), point('2026-09-10', 13000)]));
});

test('invalid payload items cannot produce NaN paths; a zero valuation stays visible', () => {
  const result = normalizeCollectionHistory([null, {}, point('invalid'), point('2026-09-01', NaN), point('2026-09-02', -1), point('2026-09-03', 0)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].total_cents, 0);
});

test('custom range includes both endpoints and preserves a genuinely empty gap', () => {
  const points = [point('2026-09-01'), point('2026-09-08'), point('2026-09-10')];
  assert.equal(historyInRange(points, '2026-09-01', '2026-09-08').length, 2);
  assert.equal(historyInRange(points, '2026-09-02', '2026-09-07').length, 0);
});

test('CSV preserves cents, count and missing currency without pretending that totals are profit', () => {
  const csv = collectionHistoryCsv([point('2026-09-01', 12345), { ...point('2026-09-02', 0), currency: null }]);
  assert.ok(csv.includes('"2026-09-01","12345","EUR","5","4"'));
  assert.ok(csv.includes('"2026-09-02","0","","5","4"'));
  assert.ok(!csv.includes('profit'));
});

test('a malformed currency is never exported as a spreadsheet formula', () => {
  const csv = collectionHistoryCsv([{ ...point('2026-09-01'), currency: '=1+1' }]);
  assert.ok(!csv.includes('=1+1'));
});
