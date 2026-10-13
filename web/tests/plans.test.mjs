import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// plans.ts e accountLimits.ts non hanno import: si caricano da soli.
function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}

const P = load('plans.ts');
const L = load('accountLimits.ts');

test('il Plus coincide con i tetti tecnici di accountLimits.ts', () => {
  assert.deepEqual({ ...P.PLAN_LIMITS.plus }, {
    binderCards: L.MAX_BINDER_CARDS,
    wishlistCards: L.MAX_WISHLIST_CARDS,
    lots: L.MAX_LOTS,
    priceAlerts: L.MAX_PRICE_ALERTS,
    filterPresets: L.MAX_FILTER_PRESETS,
  });
});

test('il Gratis non supera mai il Plus', () => {
  for (const [key, value] of Object.entries(P.PLAN_LIMITS.free)) {
    assert.ok(value > 0 && value <= P.PLAN_LIMITS.plus[key], key);
  }
});

test('fase gratuita: tutti hanno il Plus, anche senza riga o con piano scaduto', () => {
  assert.equal(P.PLUS_FOR_EVERYONE, true);
  assert.equal(P.effectivePlan(null), 'plus');
  assert.equal(P.effectivePlan({ plan: 'free', validUntil: null }), 'plus');
  assert.equal(P.effectivePlan({ plan: 'plus', validUntil: new Date('2000-01-01') }), 'plus');
});

test('dopo la fase gratuita: Plus solo se pagato e non scaduto', () => {
  const src = readFileSync(new URL('../lib/plans.ts', import.meta.url), 'utf8')
    .replace('export const PLUS_FOR_EVERYONE = true;', 'export const PLUS_FOR_EVERYONE = false;');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports });
  const now = new Date('2026-10-13T12:00:00Z');
  assert.equal(exports.effectivePlan(null, now), 'free');
  assert.equal(exports.effectivePlan({ plan: 'free', validUntil: null }, now), 'free');
  assert.equal(exports.effectivePlan({ plan: 'boh', validUntil: null }, now), 'free');
  assert.equal(exports.effectivePlan({ plan: 'plus', validUntil: null }, now), 'plus');
  assert.equal(exports.effectivePlan({ plan: 'plus', validUntil: new Date('2026-11-13T00:00:00Z') }, now), 'plus');
  assert.equal(exports.effectivePlan({ plan: 'plus', validUntil: new Date('2026-10-13T12:00:00Z') }, now), 'free');
});
