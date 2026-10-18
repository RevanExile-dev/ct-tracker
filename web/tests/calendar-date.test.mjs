import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, require = () => ({})) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, require });
  return exports;
}

const calendar = load('../lib/calendarDate.ts');
// Account dependencies are inert here: this contract test only calls the
// exported date validator and fails if it attempts database/network work.
const account = load('../lib/account.server.ts', (specifier) => {
  if (specifier === './calendarDate') return calendar;
  return new Proxy({}, { get() { throw new Error(`Unexpected account dependency: ${specifier}`); } });
});

for (const [name, validate] of [['pure helper', calendar.isValidCalendarDate], ['account API validator', account.isValidLotDate]]) {
  test(`${name}: Gregorian leap years and month boundaries are valid without date coercion`, () => {
    for (const date of ['2024-02-29', '2000-02-29', '1900-02-28', '2026-04-30', '0001-01-01', '9999-12-31']) {
      assert.equal(validate(date), true, date);
    }
    for (const date of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-02-31', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01']) {
      assert.equal(validate(date), false, date);
    }
  });

  test(`${name}: rejects non-date values and timestamps instead of reinterpreting them`, () => {
    for (const value of [null, undefined, 20261018, {}, '', '2026-1-01', '1/1/2026', ' 2026-01-01 ', '2026-01-01T00:00:00Z', '2026-01-01\n']) {
      assert.equal(validate(value), false, String(value));
    }
  });
}
