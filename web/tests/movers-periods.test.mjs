import test from "node:test";
import assert from "node:assert/strict";

// Come gli altri test unitari, importa il TypeScript direttamente (Node strip-types).
const { findMoversPeriod, formatCompareAge, DEFAULT_MOVERS_PERIOD, MOVERS_PERIODS } = await import("../lib/moversPeriods.ts");

test("periodo sconosciuto o assente = predefinito (30 giorni)", () => {
  assert.equal(DEFAULT_MOVERS_PERIOD, "30");
  assert.equal(findMoversPeriod("boh").days, 30);
  assert.equal(findMoversPeriod(null).days, 30);
  assert.equal(findMoversPeriod(undefined).key, "30");
});

test("le finestre note e 'Tutto' (nessun limite)", () => {
  assert.deepEqual(MOVERS_PERIODS.map((p) => p.days), [3, 7, 30, null]);
  assert.equal(findMoversPeriod("all").days, null);
});

test("etichetta dell'eta' del confronto", () => {
  assert.equal(formatCompareAge(0), "da oggi");
  assert.equal(formatCompareAge(1), "da ieri");
  assert.equal(formatCompareAge(12), "in 12 giorni");
  assert.equal(formatCompareAge(null), null);
  assert.equal(formatCompareAge(-3), null);
});
