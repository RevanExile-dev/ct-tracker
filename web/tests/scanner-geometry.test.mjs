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

test('absorbCandidate suppresses a small region nested inside an already-kept larger one', () => {
  // Reported real-world bug: a foil card's internal high-contrast edges
  // (illustration frame, attack text box border) each look "card-shaped
  // enough" and got kept as separate detections nested inside the true
  // outer card border - IoU alone misses this because a small box nested in
  // a much larger one has LOW IoU (the union is ~as big as the big box).
  const kept = [region('outer', 0.05, 0.05, 0.9, 0.9)];
  const nested = region('inner', 0.2, 0.2, 0.3, 0.3);
  assert.equal(image.absorbCandidate(kept, nested, 0.58), true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'outer');
});

test('absorbCandidate does not suppress two genuinely separate side-by-side cards', () => {
  // A real multi-card batch photo must still detect each card independently.
  const kept = [region('left', 0.0, 0.0, 0.45, 0.9)];
  const sideBySide = region('right', 0.5, 0.0, 0.45, 0.9);
  assert.equal(image.absorbCandidate(kept, sideBySide, 0.58), false);
});

test('absorbCandidate still catches classic same-scale duplicates via IoU', () => {
  const kept = [region('a', 0.1, 0.1, 0.7, 0.7)];
  const almostSame = region('b', 0.12, 0.11, 0.68, 0.69);
  assert.equal(image.absorbCandidate(kept, almostSame, 0.58), true);
});

test('absorbCandidate promotes the larger box when containment beats score order (real bug: Samurott V)', () => {
  // The small, high-contrast wrong region a card's internal texture produces
  // is often processed FIRST (candidates are sorted by score descending, and
  // a crisp internal edge can easily out-score the true card's soft/faint
  // physical edge - see the detectBorderRectangles test below). Containment
  // must still promote the true larger card instead of just discarding it as
  // "already covered" by the smaller region kept first.
  const kept = [region('inner-wrong', 0.2, 0.2, 0.3, 0.3, 0.95)];
  const outerCorrect = region('outer-correct', 0.05, 0.05, 0.9, 0.9, 0.5);
  assert.equal(image.absorbCandidate(kept, outerCorrect, 0.58), true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'outer-correct');
});

test('absorbCandidate keeps the larger already-kept region when a smaller nested candidate arrives later', () => {
  const kept = [region('outer', 0.05, 0.05, 0.9, 0.9, 0.5)];
  const innerWrong = region('inner', 0.2, 0.2, 0.3, 0.3, 0.95);
  assert.equal(image.absorbCandidate(kept, innerWrong, 0.58), true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'outer');
});

test('absorbCandidate still promotes the larger box when the inner/outer area ratio alone already exceeds the IoU threshold', () => {
  // Real gap found by Gemini review on this same PR: for two boxes in a
  // containment relationship, IoU = area(inner) / area(outer) (union is
  // dominated by the outer box). Once the inner box covers more than the
  // IoU threshold's fraction of the outer one's area (very common - an
  // illustration frame often covers 60-70% of a card), IoU alone already
  // exceeds iouThreshold. Checking IoU before overlapCoverage would return
  // early on that branch and never reach the size-based replacement - the
  // container fix has to run for EVERY containment ratio, not just the ones
  // below the IoU threshold. Inner here covers 70% of outer's area
  // (0.9*0.9=0.81 vs 0.7*0.7=0.49, ratio 0.605 > iouThreshold 0.58).
  const kept = [region('inner-wrong', 0.15, 0.15, 0.7, 0.7, 0.95)];
  const outerCorrect = region('outer-correct', 0.05, 0.05, 0.9, 0.9, 0.5);
  assert.equal(image.absorbCandidate(kept, outerCorrect, 0.58), true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'outer-correct');
});

test('absorbCandidate purges every already-kept smaller region absorbed by a larger outer candidate, not just the first match', () => {
  // Rilievo review Gemini: una carta puo' avere piu' di un dettaglio interno
  // ad alto contrasto gia' in kept (es. cornice illustrazione E riquadro
  // testo attacco) quando arriva il vero bordo esterno, che li contiene
  // entrambi. Un `return true` al primo match (i=0) lascerebbe il secondo
  // (kept[1]) intatto, anche se anch'esso e' contenuto nello stesso box piu'
  // grande - violando l'invariante che i box tenuti non si sovrappongono.
  const kept = [
    region('inner-art', 0.2, 0.2, 0.3, 0.3, 0.95),
    region('inner-text', 0.2, 0.6, 0.3, 0.3, 0.9),
  ];
  const outerCorrect = region('outer-correct', 0.05, 0.05, 0.9, 0.9, 0.5);
  assert.equal(image.absorbCandidate(kept, outerCorrect, 0.58), true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'outer-correct');
});

test('withFrameMargins seeds near-edge coordinates only when nothing organic is already there', () => {
  // Reported real-world bug (Samurott V, 2026-09-10): a single surviving
  // region that does not track the card's true border. pickPeaks only keeps
  // the strongest gradients - a physically weak card edge (light card on a
  // light background) can be excluded from the candidate list entirely, so
  // no scoring fix downstream can ever recover it. Seeding near-frame-edge
  // coordinates guarantees "the card fills almost the whole frame" is always
  // an evaluable candidate.
  // Array literals returned by the vm-sandboxed module are a different realm
  // than this file's - assert.deepEqual's prototype check fails even on
  // structurally identical arrays (same issue as collectorParts last night),
  // so compare via a plain string join instead of deepEqual.
  const asStr = (arr) => arr.join(',');
  assert.equal(asStr(image.withFrameMargins([], 100)), '4,96');
  // An organic peak already close to the low margin (distance 1 < margin 4):
  // do not add a near-duplicate seed there, but still seed the other edge.
  assert.equal(asStr(image.withFrameMargins([3], 100)), '3,96');
  // Organic peaks close to BOTH margins: nothing to seed.
  assert.equal(asStr(image.withFrameMargins([5, 94], 100)), '5,94');
});

function makeFrame(width, height, bg, boxes) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, [r, g, b]) => {
    const p = (y * width + x) * 4;
    rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) setPixel(x, y, bg);
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) setPixel(x, y, box.color);
    }
  }
  return rgba;
}

function iouOf(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

test('detectBorderRectangles finds a clean card-sized rectangle near the frame edge', () => {
  const width = 100;
  const height = 140;
  const cardBox = { x: 5, y: 7, width: 90, height: 126, color: [220, 220, 220] };
  const rgba = makeFrame(width, height, [20, 20, 20], [cardBox]);
  const regions = image.detectBorderRectangles(rgba, width, height);
  assert.ok(regions.length > 0, 'should find at least one region');
  const expected = {
    x: cardBox.x / width, y: cardBox.y / height,
    width: cardBox.width / width, height: cardBox.height / height,
  };
  assert.ok(iouOf(regions[0], expected) > 0.75, `expected high IoU with the true card box, got ${iouOf(regions[0], expected)}`);
});

test('a large card with a weak true border beats a smaller but higher-contrast internal rectangle', () => {
  // Simulates a light card on a light background (weak physical edge) with a
  // strongly-contrasted internal feature (illustration frame/attack box) -
  // exactly the case reported by the user where the wrong (inner) region won.
  const width = 100;
  const height = 140;
  const cardBox = { x: 4, y: 6, width: 92, height: 128, color: [40, 40, 40] };
  const innerBox = { x: 20, y: 28, width: 60, height: 80, color: [250, 250, 250] };
  const rgba = makeFrame(width, height, [30, 30, 30], [cardBox, innerBox]);
  const regions = image.detectBorderRectangles(rgba, width, height);
  assert.ok(regions.length > 0, 'should find at least one region');
  const expectedOuter = {
    x: cardBox.x / width, y: cardBox.y / height,
    width: cardBox.width / width, height: cardBox.height / height,
  };
  const expectedInner = {
    x: innerBox.x / width, y: innerBox.y / height,
    width: innerBox.width / width, height: innerBox.height / height,
  };
  const best = regions[0];
  assert.ok(
    iouOf(best, expectedOuter) > iouOf(best, expectedInner),
    `top region should track the true (larger, weak-edged) card, not the smaller high-contrast internal box`,
  );
});

test('same weak-border-vs-strong-internal case, with the internal box covering a majority of the card (real gap found by review)', () => {
  // Same scenario as above, but innerBox/cardBox area ratio is ~0.67 - above
  // the IoU dedup threshold (0.58). This is the case a first version of
  // absorbCandidate got wrong: checking IoU before overlapCoverage let the
  // IoU branch return early (since IoU = area(inner)/area(outer) already
  // exceeds 0.58 once the inner box is this large) without ever reaching
  // the size-based containment replacement, so the wrong smaller box won.
  const width = 100;
  const height = 140;
  const cardBox = { x: 4, y: 6, width: 92, height: 128, color: [40, 40, 40] };
  const innerBox = { x: 14, y: 15, width: 75, height: 105, color: [250, 250, 250] };
  const rgba = makeFrame(width, height, [30, 30, 30], [cardBox, innerBox]);
  const regions = image.detectBorderRectangles(rgba, width, height);
  assert.ok(regions.length > 0, 'should find at least one region');
  const expectedOuter = {
    x: cardBox.x / width, y: cardBox.y / height,
    width: cardBox.width / width, height: cardBox.height / height,
  };
  const expectedInner = {
    x: innerBox.x / width, y: innerBox.y / height,
    width: innerBox.width / width, height: innerBox.height / height,
  };
  const best = regions[0];
  assert.ok(
    iouOf(best, expectedOuter) > iouOf(best, expectedInner),
    `top region should track the true (larger, weak-edged) card, not the smaller high-contrast internal box`,
  );
});
