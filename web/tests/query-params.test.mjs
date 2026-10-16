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

test('splitCsv gestisce null, stringa vuota, voci multiple e vuote', () => {
  const { splitCsv } = load('../lib/queryParams.ts');

  const vuota = JSON.parse(JSON.stringify(splitCsv(null)));
  assert.deepEqual(vuota, []);

  const stringaVuota = JSON.parse(JSON.stringify(splitCsv('')));
  assert.deepEqual(stringaVuota, []);

  const semplice = JSON.parse(JSON.stringify(splitCsv('a,b')));
  assert.deepEqual(semplice, ['a', 'b']);

  const conVociVuote = JSON.parse(JSON.stringify(splitCsv('a,,b,')));
  assert.deepEqual(conVociVuote, ['a', 'b']);

  const conSpaziInterni = JSON.parse(JSON.stringify(splitCsv('Rare Holo')));
  assert.deepEqual(conSpaziInterni, ['Rare Holo']);
});
