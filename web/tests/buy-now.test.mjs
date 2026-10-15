import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}
const b = load('buyNow.ts');
const NOW = new Date('2026-10-15T12:00:00Z');
const day = (n, v) => ({ captured_at: new Date(NOW.getTime() - n * 864e5).toISOString(), min_price_cents: v, best_price_cents: v });

test('verdetto: al minimo, vicino, sopra', () => {
  const h = [day(1, 1000), day(5, 1200), day(9, 1100)];
  assert.equal(b.buyVerdict(h, 1000, 30, NOW).tone, 'good');
  assert.equal(b.buyVerdict(h, 1100, 30, NOW).tone, 'near');
  const w = b.buyVerdict(h, 1500, 30, NOW);
  assert.equal(w.tone, 'wait');
  assert.equal(w.minCents, 1000);
  assert.equal(Math.round(w.abovePct), 50);
});
test('verdetto: prezzo sotto il minimo storico = minimo; storico corto = null; punti fuori finestra ignorati', () => {
  const h = [day(1, 1000), day(5, 1200), day(9, 1100)];
  assert.equal(b.buyVerdict(h, 900, 30, NOW).abovePct, 0);
  assert.equal(b.buyVerdict([day(1, 1000), day(2, 1000)], 1000, 30, NOW), null);
  assert.equal(b.buyVerdict([day(1, 1000), day(2, 1000), day(60, 100)], 1000, 30, NOW), null);
  assert.equal(b.buyVerdict(h, null, 30, NOW), null);
});
const L = (price, hub, country, cur = 'EUR') => ({ price_cents: price, price_currency: cur, condition: 'Near Mint', language: 'it', quantity: 1, seller_username: 's' + price, can_sell_via_hub: hub, ships_from_country: country });
test('classifica: solo Zero UE, totale = prezzo + hub, fuori UE esclusi', () => {
  const c = b.compareListings([L(1000, 1, 'IT'), L(800, 1, 'US'), L(900, 1, 'DE'), L(700, 1, 'GB'), L(1200, 1, 'FR'), L(2000, 1, 'ES')], 850, 3);
  assert.deepEqual(c.ranked.map((r) => r.totalCents), [1750, 1850, 2050]);
  assert.equal(c.excluded, 2);
  assert.equal(c.cheaperNoHub, null);
});
test('non-Zero: segnalata solo se costa meno del miglior totale Zero', () => {
  const c = b.compareListings([L(1000, 1, 'IT'), L(1500, 0, 'IT'), L(400, 0, 'DE')], 850);
  assert.equal(c.cheaperNoHub.price_cents, 400);
  const d = b.compareListings([L(1000, 1, 'IT'), L(1900, 0, 'IT')], 850);
  assert.equal(d.cheaperNoHub, null);
  const e = b.compareListings([L(1900, 0, 'IT')], 850);
  assert.equal(e.ranked.length, 0);
  assert.equal(e.cheaperNoHub.price_cents, 1900);
});
