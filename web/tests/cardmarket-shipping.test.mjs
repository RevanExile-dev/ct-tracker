import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Moduli senza import: si caricano da soli, come in binder-quantity.test.mjs.
function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}

const ship = load('cardmarketShipping.ts');
const cm = load('cardmarket.ts');

test('una carta da meno di 25 euro: lettera non tracciata da 1,60', () => {
  const e = ship.estimateShipping(402, 1);
  assert.equal(e.italyCents, 160);
  assert.equal(e.abroadMaxCents, null);
});

test('il confine dei 25 euro: 25,00 e ancora lettera, 25,01 e raccomandata', () => {
  assert.equal(ship.estimateShipping(2500, 1).italyCents, 160);
  assert.equal(ship.estimateShipping(2501, 1).italyCents, 650);
});

test('tra 25 e 50 euro c\'e il tetto per un venditore estero (~16 euro)', () => {
  const e = ship.estimateShipping(3000, 1);
  assert.equal(e.italyCents, 650);
  assert.equal(e.abroadMaxCents, 1604);
});

test('scaglioni alti e oltre la tabella', () => {
  assert.equal(ship.estimateShipping(5001, 1).italyCents, 755);
  assert.equal(ship.estimateShipping(10000, 1).italyCents, 1140);
  assert.equal(ship.estimateShipping(50000, 1).italyCents, 2170);
  assert.equal(ship.estimateShipping(250000, 1).italyCents, 2440);
  assert.equal(ship.estimateShipping(300001, 1), null);
});

test('piu\' carte dello stesso venditore: una sola spedizione, scaglione per numero carte', () => {
  assert.equal(ship.estimateShipping(2000, 4).italyCents, 160);
  assert.equal(ship.estimateShipping(2000, 5).italyCents, 825);
  assert.equal(ship.estimateShipping(2000, 18).italyCents, 885);
  assert.equal(ship.estimateShipping(2000, 41), null);
});

test('valori non validi non producono una stima', () => {
  for (const v of [0, -5, NaN, Infinity]) assert.equal(ship.estimateShipping(v, 1), null, String(v));
  assert.equal(ship.estimateShipping(500, 0), null);
  assert.equal(ship.estimateShipping(500, NaN), null);
});

test('esempio busta da 17 carte: 8,25 diviso 17', () => {
  const b = ship.bundleExample();
  assert.deepEqual({ ...b }, { cards: 17, totalCents: 825, perCardCents: 49 });
});

const NOW = Date.parse('2026-10-11T12:00:00Z');
const prices = (trend) => ({ trend_cents: trend, low_cents: null, avg_cents: null, avg1_cents: null, avg7_cents: null, avg30_cents: null });

test('il riferimento si mostra fino a 3 giorni, poi sparisce', () => {
  const mk = (iso) => ({ updated_at: iso, base: prices(402), holo: null });
  assert.ok(cm.visibleCardmarketReference(mk('2026-10-11T00:00:00Z'), NOW));
  assert.ok(cm.visibleCardmarketReference(mk('2026-10-08T12:00:00Z'), NOW), 'esattamente 3 giorni');
  assert.equal(cm.visibleCardmarketReference(mk('2026-10-08T11:59:00Z'), NOW), null);
});

test('niente da mostrare: null, data illeggibile, prezzi tutti vuoti', () => {
  assert.equal(cm.visibleCardmarketReference(null, NOW), null);
  assert.equal(cm.visibleCardmarketReference(undefined, NOW), null);
  assert.equal(cm.visibleCardmarketReference({ updated_at: 'boh', base: prices(1), holo: null }, NOW), null);
  assert.equal(cm.visibleCardmarketReference({ updated_at: '2026-10-11T00:00:00Z', base: prices(null), holo: null }, NOW), null);
});

test('una variante vuota viene scartata, l\'altra resta', () => {
  const r = cm.visibleCardmarketReference({ updated_at: '2026-10-11T00:00:00Z', base: prices(null), holo: prices(900) }, NOW);
  assert.equal(r.base, null);
  assert.equal(r.holo.trend_cents, 900);
});

test('valore per la spedizione: trend normale, altrimenti holo', () => {
  assert.equal(cm.referenceValueCents({ updated_at: 'x', base: prices(402), holo: prices(900) }), 402);
  assert.equal(cm.referenceValueCents({ updated_at: 'x', base: null, holo: prices(900) }), 900);
  assert.equal(cm.referenceValueCents({ updated_at: 'x', base: prices(null), holo: null }), null);
});

test('valore per la spedizione: anche solo con le medie a 7/30 giorni; zero non conta come prezzo', () => {
  const only7 = { ...prices(null), avg7_cents: 700 };
  assert.equal(cm.referenceValueCents({ updated_at: 'x', base: only7, holo: null }), 700);
  const only30 = { ...prices(null), avg30_cents: 650 };
  assert.equal(cm.referenceValueCents({ updated_at: 'x', base: only30, holo: null }), 650);
  const zeros = { ...prices(0), low_cents: 0, avg7_cents: 0 };
  assert.equal(cm.visibleCardmarketReference({ updated_at: '2026-10-11T00:00:00Z', base: zeros, holo: null }, NOW), null);
});

test('Zero verso l\'Italia: 8,50 fino a 44 carte, 10,50 fino a 10 kg, poi niente stima', () => {
  assert.deepEqual({ ...ship.zeroHubShipping(1) }, { cents: 850, maxCards: 44 });
  assert.equal(ship.zeroHubShipping(44).cents, 850);
  assert.equal(ship.zeroHubShipping(45).cents, 1050);
  assert.equal(ship.zeroHubShipping(4994).cents, 1050);
  assert.equal(ship.zeroHubShipping(4995), null);
  for (const n of [0, -1, NaN]) assert.equal(ship.zeroHubShipping(n), null, String(n));
});
