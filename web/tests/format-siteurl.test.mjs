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

test('percentuali e numeri sono in formato italiano (virgola decimale; il punto sulle migliaia dipende da ICU per i numeri a 4 cifre)', () => {
  const { formatNumber, formatPercent } = load('../lib/format.ts');
  assert.match(formatPercent(2231.8, 1), /^2\.?231,8%$/);
  assert.equal(formatPercent(0, 1), '0,0%');
  assert.equal(formatPercent(12.345, 2), '12,35%');
  assert.equal(formatNumber(30189), '30.189');
  assert.equal(formatNumber(427), '427');
});

test('URL del sito: variabile esplicita, poi dominio di produzione Vercel, poi quello reale (mai ct-tracker.vercel.app)', () => {
  const run = (env) => load('../lib/siteUrl.ts', { process: { env } }).getSiteUrl();
  assert.equal(run({ NEXT_PUBLIC_SITE_URL: 'https://esempio.it/' }), 'https://esempio.it');
  assert.equal(run({ VERCEL_PROJECT_PRODUCTION_URL: 'ct-tracker-eight.vercel.app' }), 'https://ct-tracker-eight.vercel.app');
  assert.equal(run({}), 'https://ct-tracker-eight.vercel.app');
  assert.notEqual(run({}), 'https://ct-tracker.vercel.app');
});
