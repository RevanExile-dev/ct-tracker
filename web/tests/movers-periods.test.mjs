import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// moversPeriods.ts non ha import: si carica da solo (come plans.test.mjs).
const exports = {};
const code = ts.transpileModule(readFileSync(new URL("../lib/moversPeriods.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, { exports, module: { exports } });
const { findMoversPeriod, formatCompareAge, DEFAULT_MOVERS_PERIOD, MOVERS_PERIODS } = exports;

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
  assert.equal(formatCompareAge(12), "in 12 gg");
  assert.equal(formatCompareAge(null), null);
  assert.equal(formatCompareAge(-3), null);
});
