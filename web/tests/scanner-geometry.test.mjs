import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// detectBorderRectangles/detectConnectedComponents take raw pixel arrays, not
// DOM/Canvas - no browser needed to exercise the pure logic that dedupes
// candidate rectangles.
function loadModule(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => { throw new Error(`Unexpected dependency: ${id}`); } });
  return exports;
}
const image = loadModule('../lib/scanner/image.ts');

const region = (id, x, y, width, height, score = 0.5) => ({ id, x, y, width, height, score });

test('overlapsExisting suppresses a small region nested inside an already-kept one', () => {
  // Reported real-world bug: a foil card's internal high-contrast edges
  // (illustration frame, attack text box border) each look "card-shaped
  // enough" and got kept as separate detections nested inside the true
  // outer card border - IoU alone misses this because a small box nested in
  // a much larger one has LOW IoU (the union is ~as big as the big box).
  const kept = [region('outer', 0.05, 0.05, 0.9, 0.9)];
  const nested = region('inner', 0.2, 0.2, 0.3, 0.3);
  assert.equal(image.overlapsExisting(kept, nested, 0.58), true);
});

test('overlapsExisting does not suppress two genuinely separate side-by-side cards', () => {
  // A real multi-card batch photo must still detect each card independently.
  const kept = [region('left', 0.0, 0.0, 0.45, 0.9)];
  const sideBySide = region('right', 0.5, 0.0, 0.45, 0.9);
  assert.equal(image.overlapsExisting(kept, sideBySide, 0.58), false);
});

test('overlapsExisting still catches classic same-scale duplicates via IoU', () => {
  const kept = [region('a', 0.1, 0.1, 0.7, 0.7)];
  const almostSame = region('b', 0.12, 0.11, 0.68, 0.69);
  assert.equal(image.overlapsExisting(kept, almostSame, 0.58), true);
});
