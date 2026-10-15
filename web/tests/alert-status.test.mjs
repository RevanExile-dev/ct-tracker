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
  vm.runInNewContext(code, { exports });
  return exports;
}
const { alertStatus, alertThresholdCents } = load('../lib/alertStatus.ts');
const fmt = (c) => `${(c / 100).toFixed(2)} €`;
const base = { state: 'armed', targetType: 'absolute_cents', targetValue: 1000, baselinePriceCents: 1500,
  baselineCurrency: 'EUR', fireMode: 'once', rearmCooldownHours: null, matchingPriceCents: 1250, matchingPriceCurrency: 'EUR' };

test('soglia: assoluta e percentuale (come _alert_target_met)', () => {
  assert.equal(alertThresholdCents(base), 1000);
  assert.equal(alertThresholdCents({ ...base, targetType: 'percent_drop', targetValue: 25 }), 1125);
  assert.equal(alertThresholdCents({ ...base, targetType: 'percent_drop', baselinePriceCents: null }), null);
});
test('armato sopra soglia: dice quanto manca', () => {
  const s = alertStatus(base, fmt);
  assert.match(s.text, /Ora 12\.50 €, soglia 10\.00 €: mancano 2\.50 € \(−20%\)/);
  assert.equal(s.tone, 'wait');
});
test('armato gia\' sotto soglia: scatta al prossimo controllo', () => {
  assert.match(alertStatus({ ...base, matchingPriceCents: 900 }, fmt).text, /già sotto la soglia/);
});
test('nessuna offerta col profilo: lo dice', () => {
  assert.match(alertStatus({ ...base, matchingPriceCents: null }, fmt).text, /Nessuna offerta con questo profilo/);
});
test('scattato once / rearm', () => {
  assert.match(alertStatus({ ...base, state: 'fired' }, fmt).text, /finché non lo riattivi/);
  assert.match(alertStatus({ ...base, state: 'fired', fireMode: 'rearm', rearmCooldownHours: 12 }, fmt).text, /dopo 12 h/);
});
test('disattivato e dato assente', () => {
  assert.match(alertStatus({ ...base, state: 'disabled' }, fmt).text, /Disattivato/);
  assert.equal(alertStatus({ ...base, matchingPriceCents: undefined }, fmt), null);
});
