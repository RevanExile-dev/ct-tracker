import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/cardImage.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}
const { cardImageSources } = load();

test('immagine CardTrader: salta il redirect verso www e offre la variante preview_', () => {
  const r = cardImageSources('https://cardtrader.com/uploads/blueprints/image/1/a-b(2).jpg');
  assert.equal(r.src, 'https://www.cardtrader.com/uploads/blueprints/image/1/a-b(2).jpg');
  assert.equal(
    r.srcSet,
    'https://www.cardtrader.com/uploads/blueprints/image/1/preview_a-b(2).jpg 180w, /api/img?p=1%2Fa-b(2).jpg&w=360 360w, /api/img?p=1%2Fa-b(2).jpg&w=540 540w, https://www.cardtrader.com/uploads/blueprints/image/1/a-b(2).jpg 734w',
  );
});

test('nome file insolito: niente rotta di ridimensionamento, resta l\'intera', () => {
  const r = cardImageSources('https://cardtrader.com/uploads/blueprints/image/1/a,b.jpg');
  assert.match(r.srcSet, /a,b\.jpg 734w$/);
});

test('URL gia con www e altri host', () => {
  assert.equal(cardImageSources('https://www.cardtrader.com/x/y.jpg').src, 'https://www.cardtrader.com/x/y.jpg');
  const o = cardImageSources('https://d2rq8wty021h6h.cloudfront.net/x/y.jpg');
  assert.equal(o.src, 'https://d2rq8wty021h6h.cloudfront.net/x/y.jpg');
  assert.equal(o.srcSet, undefined);
});
