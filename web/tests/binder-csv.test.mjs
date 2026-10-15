import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/binderCsv.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}
const mod = load();
const { buildBinderCsv } = mod;
// Il modulo gira in un contesto vm: gli array hanno un prototipo diverso e
// deepEqual li rifiuterebbe, quindi si confronta il JSON.
const parseBinderCsv = (text) => JSON.parse(JSON.stringify(mod.parseBinderCsv(text)));

const row = (over = {}) => ({
  id: 7, name: 'Pikachu', version: null, setName: 'Set; "uno"', language: 'it', condition: 'NM',
  finish: 'foil', quantity: 3, unitCents: 1250, currency: 'EUR', ...over,
});

test('export: BOM, header, decimal comma, total = unit x quantity', () => {
  const csv = buildBinderCsv([row()]);
  assert.ok(csv.startsWith('﻿id;carta;'));
  assert.match(csv, /7;Pikachu;;"Set; ""uno""";it;NM;foil;3;12,50;EUR;37,50/);
});

test('export: unknown price leaves price cells empty; formula cells are neutralised', () => {
  const csv = buildBinderCsv([row({ name: '=HYPERLINK("x")', unitCents: null })]);
  assert.ok(csv.includes('\'=HYPERLINK'), 'apice davanti alla formula');
  assert.match(csv, /;3;;;\r\n$/);
});

test('round trip: what we export we re-import identically', () => {
  const rows = [row(), row({ id: 9, name: 'Mew', language: null, condition: null, finish: 'unknown', quantity: 1 })];
  const { rows: parsed, warnings } = parseBinderCsv(buildBinderCsv(rows));
  assert.deepEqual(warnings, []);
  assert.deepEqual(parsed.map((r) => [r.id, r.language, r.condition, r.finish, r.quantity]), [
    [7, 'it', 'NM', 'foil', 3], [9, null, null, 'unknown', 1],
  ]);
});

test('import: accepts comma delimiter, bad quantity -> 1 with warning, bad/duplicate ids skipped', () => {
  const { rows, warnings } = parseBinderCsv('id,quantita,finitura\n5,0,sparkly\nabc,2,foil\n5,4,foil\n6,2,foil');
  assert.deepEqual(rows.map((r) => [r.id, r.quantity, r.finish]), [[5, 1, 'unknown'], [6, 2, 'foil']]);
  assert.equal(warnings.length, 3);
});

test('import: missing id column and empty file give a clear message', () => {
  assert.match(parseBinderCsv('carta;set\nA;B').warnings[0], /id/);
  assert.equal(parseBinderCsv('').rows.length, 0);
});
