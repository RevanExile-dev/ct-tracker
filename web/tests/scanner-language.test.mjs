import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../lib/scanner/ocr.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const ocr = {};
vm.runInNewContext(code, { exports: ocr, require: (id) => { throw new Error(`Unexpected dependency: ${id}`); } });

test('pochi caratteri CJK inventati dal modello non rendono giapponese una carta inglese', () => {
  // Testo reale letto dalla fascia attacchi di Alolan Meowth 139/128 (inglese).
  const noisy = "il CUL 上 ad\nur Em 7 i\nに Esa\nWi ーー一\nい |\nDraw afcard\nweakness (6人 x12} LN E: v\nNos YOKUBO ldsgacelistome to live with\n本アイママ がT IE";
  assert.notEqual(ocr.detectLanguage(noisy).code, 'jp');
  assert.equal(ocr.detectLanguage('Weakness resistance retreat damage opponent').code, 'en');
});

test('una carta giapponese vera resta giapponese', () => {
  const japanese = 'ワザ はばたく 30 相手のバトルポケモンに ダメージ 弱点 抵抗力 にげる HP 90';
  assert.equal(ocr.detectLanguage(japanese).code, 'jp');
});
