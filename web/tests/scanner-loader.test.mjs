import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../components/scanner/ScanLoader.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mod = {};
vm.runInNewContext(code, { exports: mod, require: () => new Proxy({}, { get: () => () => null }) });

test('il messaggio dice la verita\' sul tempo: breve, poi "con piu\' attenzione", poi carta difficile', () => {
  assert.match(mod.loaderMessage('reading', 0).title, /Leggo nome e numero/);
  assert.match(mod.loaderMessage('reading', 6).title, /più attenzione/);
  const long = mod.loaderMessage('reading', 15);
  assert.match(long.title, /difficile/);
  assert.match(long.hint, /Non chiudere la pagina/);
});

test('le altre fasi hanno il proprio messaggio, indipendente dal tempo', () => {
  assert.match(mod.loaderMessage('matching', 30).title, /catalogo/);
  assert.match(mod.loaderMessage('queued', 30).title, /coda/);
});
