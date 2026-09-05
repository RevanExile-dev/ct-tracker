# Card Scanner & Recognition — Architecture

Status: proposed architecture for issue #20.  
Coordinator: Claude Code.  
Purpose of this document: make the scanner implementation reproducible across sessions and keep product/technical decisions out of chat history.

## 1. Product goal

Add a first-class scanner to CartaViva that can identify one or more physical Pokémon TCG cards from either:

- the rear camera on a phone;
- an uploaded image on mobile or desktop.

The scanner must resolve each physical card to an **existing CardTrader `blueprint_id`** already present in CartaViva, detect the physical copy's language, then let the user:

- open CartaViva's normal card detail;
- inspect current price/listing information, preferably in the detected language;
- add the result to the Binder;
- for a batch, review/correct results and add selected/all cards.

The scanner is a recognition layer over the existing catalog. It must not create a parallel card catalog or duplicate pricing logic.

## 2. Constraints inherited from the current project

These are hard product constraints unless the user explicitly changes them later.

1. **Zero recurring cost baseline.** No paid vision API is required for normal operation.
2. **Client-first architecture.** CartaViva currently reads its SQLite catalog in the browser through `sql.js`; scanner runtime should follow the same philosophy where practical.
3. **No new always-on backend just for recognition.** Build-time processing in GitHub Actions is acceptable; server-side GPU inference is not part of the baseline.
4. **Binder remains local.** Current Binder persistence is localStorage. Scanner work must not silently turn it into a server-synced collection.
5. **Existing identity remains authoritative.** `blueprint_id` is the canonical card identity.
6. **Language is separate from identity.** Physical-copy language is metadata for the recognized copy / marketplace query, not a new blueprint.
7. **Normal catalog navigation must not pay scanner costs.** Heavy libraries, OCR workers and scanner indexes should be lazy-loaded only on `/scan` or when explicitly needed.
8. **Ambiguity must be visible.** A weak match must never be presented as certain.

## 3. Current repository facts relevant to the design

The current catalog already stores, per blueprint:

- `id` (CardTrader blueprint ID);
- `name`;
- `version`;
- expansion ID/code/name;
- image URL;
- rarity and other catalog metadata.

Current market data already stores languages on listings and aggregates language availability. `web/lib/db.ts` already supports filtering card results by explicit blueprint IDs and marketplace attributes.

The current local Binder stores only a set of blueprint IDs. That is enough for presence/absence, but not enough for scanner-driven quantity/language tracking.

## 4. High-level architecture

```text
CAMERA / FILE
     |
     v
orientation + resize normalization
     |
     v
card geometry detection
     |
     +---- crop #1
     +---- crop #2
     +---- crop #N
              |
              v
perspective correction
              |
              v
visual fingerprint extraction
              |
              v
candidate retrieval from scanner index
              |
              v
targeted OCR + collector-number parsing
              |
              v
language classification
              |
              v
candidate scoring + confidence/margin
              |
      +-------+---------+
      |                 |
      v                 v
high confidence      ambiguous
      |                 |
      v                 v
auto-select         show top candidates
      |
      v
{ blueprintId, language, confidence }
      |
      +--> existing card detail
      +--> existing pricing/listings
      +--> Binder
```

Recognition should be a staged narrowing pipeline, not one giant OCR/AI call.

## 5. Why a deterministic catalog matcher is preferred

CartaViva's problem is easier than open-world image recognition:

- the target universe is known;
- every result must map to an existing catalog row;
- reference artwork images already exist;
- collector number, artwork and card name provide independent signals;
- most language variants share the same artwork even when the text differs.

Therefore the baseline should use **visual similarity + OCR disambiguation** rather than a general-purpose multimodal model.

Benefits:

- no per-scan API cost;
- works offline after required assets/indexes are cached;
- privacy: captured images do not need to leave the device;
- deterministic, testable confidence logic;
- no dependency on model/provider availability;
- easier regression testing using fixed image fixtures.

A remote vision model could remain an optional future fallback, but it must not be required for the baseline.

## 6. Delivery strategy: isolate unknowns early

Do not implement camera, multi-card, language, Binder v2 and OCR simultaneously.

The first milestone should intentionally separate **recognition quality** from **card detection quality**.

### M1a — recognition-only spike

Input: already-cropped/rectified photos of single cards.  
Goal: prove that physical-card photos can be matched against CartaViva's catalog images with useful accuracy.

Test:

- clean front-facing phone photos;
- moderate perspective;
- glare;
- sleeve reflections;
- different lighting/backgrounds;
- Italian/English versions of the same artwork;
- visually similar variants of the same Pokémon;
- cards with the same name across sets.

Output must include top-K candidates and raw signal scores.

### M1b — geometry spike

Only after the matcher is measurable, add automatic rectangle detection and perspective correction. This prevents recognition errors and geometry errors from being conflated.

The team should explicitly decide after M1 whether the proposed fingerprint approach is good enough before building production UI.

## 7. Scanner reference index

### 7.1 Prefer a scanner-specific lazy asset

For production, prefer a scanner-specific generated index such as:

```text
web/public/data/scanner_index.json
```

or, after profiling, a compact binary representation.

Reason: scanner-only data should be loaded only by scanner routes. The core catalog DB does not need to grow just because recognition exists.

Initial JSON shape can be simple:

```ts
type ScannerIndexEntry = {
  blueprintId: number;
  imageUrlHash: string;
  fullPhash: string;
  artPhash: string | null;
  edgeHash?: string | null;
};
```

If JSON size becomes material, move to:

- packed `ArrayBuffer`/typed arrays;
- one row per blueprint with 64-bit hashes;
- a tiny metadata header with `fingerprintVersion` and catalog timestamp.

### 7.2 Build-time generation

Add a build/sync helper, likely under `scripts/`, e.g.:

```text
scripts/build_scanner_index.py
```

Responsibilities:

1. read current `blueprints` from `data/cardtrader.db`;
2. find rows with usable `image_url`;
3. download reference images during CI/build-time, not at recognition time;
4. compute deterministic fingerprints;
5. reuse existing fingerprints when source image identity has not changed;
6. write the scanner index deterministically;
7. record a `fingerprintVersion` so algorithm changes can force rebuilds.

The current Python environment only guarantees `requests`; image-processing dependencies must be added deliberately when the spike proves which library is actually needed. Do not expand production dependencies before M1 validates the approach.

### 7.3 Caching / incremental rebuild

Do not redownload every card image on every catalog sync.

Maintain enough state to determine whether a row needs recomputation, e.g. source image URL hash + algorithm version. Possible implementation forms:

- a small SQLite cache table in a scanner-only build cache;
- a JSON cache adjacent to the generated index;
- scanner fingerprint rows in `cardtrader.db` only as build metadata, while the browser still consumes a separate scanner asset.

The final choice should optimize simplicity and Git diff size.

## 8. Fingerprints and candidate retrieval

### 8.1 Signals to evaluate in M1

Do not lock the algorithm before measuring it. Evaluate at least:

1. **Full-card perceptual hash** — useful when layout/text/reference image is close.
2. **Artwork-region perceptual hash** — expected to be more language-agnostic and more robust across printed languages.
3. **Edge/layout signature** — may help separate highly similar art variants.
4. **Optional compact color descriptor** — low weight only; lighting changes make color fragile.

Artwork crop can be either:

- fixed normalized coordinates after perspective correction;
- template-aware crop by card era/layout if one global crop proves insufficient.

Start with the simplest fixed crop and add eras/layout classes only if measurements justify them.

### 8.2 Candidate search

A linear Hamming-distance scan over a few thousand / tens of thousands of tiny hashes is likely cheap enough in JavaScript. Measure before adding a complicated ANN index.

Runtime candidate retrieval should return raw top-K candidates, for example:

```ts
type VisualCandidate = {
  blueprintId: number;
  fullDistance: number | null;
  artDistance: number | null;
  edgeDistance?: number | null;
};
```

Suggested K for downstream OCR: 5–20, to be tuned empirically.

### 8.3 Worker boundary

Fingerprint extraction and candidate scoring should run off the main UI thread when profiling shows it is useful. A dedicated scanner worker is preferable to scattering WebWorkers across components.

Proposed path:

```text
web/workers/scanner.worker.ts
```

The worker should communicate with typed messages, not UI-specific objects.

## 9. Geometry and card detection

OpenCV.js is the leading baseline candidate because the task is classical computer vision.

Pipeline:

1. normalize EXIF/orientation;
2. downscale a working copy for detection;
3. grayscale / light denoise;
4. edge detection;
5. contour extraction;
6. polygon approximation;
7. keep convex quadrilaterals with plausible card aspect ratio and area;
8. merge/de-duplicate overlapping detections;
9. order corners consistently;
10. perspective warp to a canonical card canvas.

The final recognition crop should be generated from the highest-resolution useful source, not the small detection frame.

### 9.1 Multi-card detection rules

For a batch image:

- support multiple non-overlapping card rectangles;
- cap the number of detections per frame to prevent pathological work;
- use NMS/overlap rules to avoid recognizing the same card twice;
- expose rejected/weak rectangles for debug during M1/M5, but not necessarily in final UI.

### 9.2 Card stability for camera mode

Do not OCR every live frame.

Recommended production behavior:

- camera preview runs normally;
- cheap rectangle detection is throttled (for example 2–4 times/sec after measurement);
- recognition runs after explicit capture in V1;
- optional later enhancement: auto-capture after the same card polygon remains stable for several samples and blur/glare checks are acceptable.

Explicit capture is the safer V1 because it reduces heat, battery and nondeterministic camera behavior.

## 10. OCR strategy

OCR is a **second-stage disambiguator**, not the first-stage search engine.

Primary regions:

- collector number (`203/191`, etc.);
- card name;
- limited template/body text used for language classification.

A browser WASM OCR engine such as Tesseract.js is a candidate, but M1 must measure:

- bundle/worker startup cost;
- memory on real phones;
- collector-number accuracy;
- robustness under sleeve/glare;
- whether one Latin OCR model is sufficient for keyword extraction across IT/EN/FR/DE/ES or multiple models are required.

### 10.1 Collector-number parsing

Collector number is one of the strongest disambiguators.

Normalize OCR aggressively:

```text
O -> 0 where context is numeric
I/l -> 1 where context is numeric
spaces removed
full-width digits normalized
```

Parse forms such as:

```text
123/198
203/191
TG12/TG30
SV107/SV122
SWSH123
```

Do not assume one numeric pattern covers all Pokémon eras/promos. Build a tested parser with explicit fixtures from the catalog.

### 10.2 Candidate-aware OCR

Once visual matching returns candidate blueprints, use their metadata to reduce OCR ambiguity:

- candidate names provide expected strings for fuzzy matching;
- candidate expansion/number conventions can constrain collector-number parsing;
- if top candidates are all the same artwork across language variants, focus OCR effort on language rather than identity.

## 11. Language detection

Language confidence must be tracked independently from card identity confidence.

Conceptual result:

```ts
type LanguageResult = {
  code: string | null;      // e.g. "it", "en", "jp"
  confidence: number;
  evidence: string[];
};
```

### 11.1 Script-first classification

Strong signals:

- Japanese kana/kanji -> Japanese;
- Hangul -> Korean;
- other scripts if supported later.

### 11.2 Latin-language classification

Use multiple weak signals together:

- OCR text;
- template labels / frequent card terms;
- attack/effect vocabulary;
- weakness/resistance/retreat equivalents;
- fuzzy matching to a small language lexicon.

Examples of useful template vocabulary (illustrative, not a complete dictionary):

- IT: `Debolezza`, `Resistenza`, `Ritirata`;
- EN: `Weakness`, `Resistance`, `Retreat`;
- FR: `Faiblesse`, `Résistance`, `Retraite`;
- DE: `Schwäche`, `Resistenz`, `Rückzug`;
- ES: `Debilidad`, `Resistencia`, `Retirada`.

Do not infer language from the cheapest marketplace listing. The detected physical card language is independent from whatever listing happens to be cheapest.

## 12. Final candidate scoring

Do not hard-code final weights before M1 data exists.

A candidate score may combine:

```text
visual artwork similarity
visual full-card similarity
collector-number agreement
card-name fuzzy match
expansion/number consistency
```

Language should generally not determine blueprint identity unless the CardTrader catalog itself distinguishes a specific product that way.

### 12.1 Confidence must include margin

Absolute score is not enough.

Example:

```text
candidate A = 0.91
candidate B = 0.90
```

is ambiguous even though A looks high.

Whereas:

```text
candidate A = 0.88
candidate B = 0.52
```

may be safer.

Use both:

- absolute match quality;
- gap/margin to the next candidate;
- agreement between independent signals.

### 12.2 Product confidence bands

Initial UX bands can be:

- **high**: auto-selected, still editable;
- **medium**: show best guess plus 2–3 alternatives;
- **low**: no silent selection; ask for recapture or manual candidate choice.

Thresholds must come from fixtures, not intuition.

## 13. Runtime data contracts

Suggested types:

```ts
type ScanSource = "camera" | "upload";

type DetectedCardRegion = {
  id: string;
  corners: Array<{ x: number; y: number }>;
  cropWidth: number;
  cropHeight: number;
};

type CandidateScore = {
  blueprintId: number;
  score: number;
  visualScore: number;
  collectorNumberScore?: number;
  nameScore?: number;
};

type RecognitionResult = {
  detectionId: string;
  blueprintId: number | null;
  language: string | null;
  identityConfidence: number;
  languageConfidence: number;
  candidates: CandidateScore[];
  warnings: string[];
};
```

Warnings can include:

- `blur`;
- `glare`;
- `card_too_small`;
- `crop_incomplete`;
- `ambiguous_identity`;
- `language_uncertain`.

Keep recognition data independent of React components so it can be unit tested.

## 14. Proposed frontend structure

```text
web/
  app/
    scan/
      page.tsx

  components/
    scanner/
      CardScanner.tsx
      CameraView.tsx
      UploadZone.tsx
      DetectionOverlay.tsx
      ScanResultCard.tsx
      ScanResults.tsx

  lib/
    scanner/
      types.ts
      imageNormalization.ts
      detectCards.ts
      rectifyCard.ts
      fingerprint.ts
      scannerIndex.ts
      candidates.ts
      collectorNumber.ts
      ocr.ts
      language.ts
      confidence.ts
      recognize.ts

  workers/
    scanner.worker.ts
```

This is a guide, not a mandate. Claude should adapt paths if current Next.js conventions make another split cleaner.

## 15. Scanner UI

### 15.1 Entry screen

`/scan` should make the two acquisition modes explicit:

- `Usa fotocamera`;
- `Carica immagine`.

On desktop, upload/drag-drop is primary. On mobile, camera is primary but upload remains available.

### 15.2 Camera screen

Include:

- rear-camera preview;
- card framing guidance;
- visible capture button;
- status hints (`avvicina`, `troppo sfocata`, etc. only if reliably measured);
- cancel/back;
- optional torch control only if browser/device support is robust enough.

Do not block manual capture just because heuristic quality checks are imperfect.

### 15.3 Results

Each detected card gets a result row/card with:

- recognized CartaViva image/name;
- set/version/rarity;
- detected language + confidence state;
- price summary from existing data;
- `Apri carta`;
- `Aggiungi al Binder`;
- correction affordance when alternatives exist.

Batch screen additionally supports:

- select all / deselect;
- `Aggiungi selezionate`;
- count of high/ambiguous/failed detections.

## 16. Pricing integration

Scanner must not own a second pricing implementation.

After recognition yields a `blueprintId`, use existing CartaViva DB functions and card components.

Detected language can be passed into existing listing/language filters when the UI asks for a language-specific price.

Important distinction:

- **identity:** blueprint/card;
- **physical-copy language:** detected from scan;
- **market availability:** current listings may or may not exist in that language.

If no listing exists in the detected language, UI should say so and optionally show a general/best market price as a clearly labeled fallback. Never silently label another-language price as the detected-language price.

## 17. Binder v2

Do not implement this before scanner recognition is proven.

Current Binder is effectively:

```ts
Set<blueprintId>
```

Scanner use cases need at least:

```ts
type BinderEntry = {
  blueprintId: number;
  language: string | null;
  quantity: number;
  condition?: string;
  finish?: "normal" | "foil" | "reverse" | "unknown";
  addedAt: string;
};
```

### 17.1 Migration

Migration must be one-way-safe and preserve all current entries.

Legacy IDs become, for example:

```ts
{
  blueprintId: legacyId,
  language: null,
  quantity: 1,
  finish: "unknown",
  addedAt: migrationTime
}
```

Requirements:

- migration is idempotent;
- old data is not deleted until the new representation validates;
- if migration fails, Binder remains readable;
- UI must continue to support normal add/remove flows without requiring scanner usage.

### 17.2 Identity of a Binder entry

Likely logical key for aggregation:

```text
blueprintId + language + finish + condition(optional)
```

But condition should only become part of the key if product UX actually needs separately tracked conditions. Avoid over-modeling M6.

## 18. Multi-card processing

For one captured/uploaded image:

1. detect all plausible card rectangles;
2. rectify each crop;
3. enqueue recognition jobs;
4. limit OCR concurrency, especially on phones;
5. stream results into UI as each finishes;
6. preserve source order / spatial order for understandable review.

Recommended initial concurrency:

- fingerprint candidate work can be parallel/light;
- OCR should use a very small worker pool (often 1–2 on mobile), determined by profiling.

Do not instantiate one OCR worker per detected card.

## 19. Performance budget

Performance targets should be measured on a real mid/high-range Android phone, not desktop only.

Track at least:

- scanner JS/WASM lazy download size;
- scanner-index size;
- OCR language-data download size;
- time to camera ready;
- time capture -> first result;
- time capture -> all results for 1/4/9 cards;
- peak memory;
- main-thread long tasks;
- battery/thermal behavior during repeated scans.

Normal pages must not load OpenCV/OCR scanner bundles merely because the feature exists.

## 20. Privacy and security

Baseline privacy contract:

- camera images are processed locally in the browser;
- photos are not uploaded to CartaViva infrastructure;
- no scan image is persisted unless the user later explicitly asks for such a feature;
- no camera permission is requested before the user enters camera mode;
- stop media tracks immediately when leaving the camera screen/component.

Input hardening:

- cap decoded image dimensions/bytes before expensive processing;
- reject unsupported/corrupt file types gracefully;
- guard against excessive numbers of detected regions;
- terminate/recycle workers cleanly;
- never include repository/API secrets in client code.

## 21. Testing strategy

### 21.1 Recognition fixture corpus

Create a reproducible fixture corpus. Do not rely only on manual ad-hoc testing.

For each physical/reference card family, include variants such as:

- clean reference-like crop;
- rotated/perspective image;
- dim light;
- warm/cool light;
- sleeve;
- glare;
- busy background;
- partial shadow;
- different supported languages;
- same Pokémon/name across multiple sets;
- near-duplicate visual variants.

Avoid committing huge unbounded image sets to the main repository without considering repo size. A small curated set is enough initially; larger benchmark assets can use an appropriate test-asset strategy later.

### 21.2 Metrics

At minimum report:

- Top-1 identity accuracy;
- Top-3 identity accuracy;
- confident-error rate (most dangerous metric);
- abstention/ambiguous rate;
- language accuracy by language;
- mean/p95 recognition time.

The goal is not just high accuracy; it is **very low confident-error rate**.

### 21.3 Unit tests

Unit-test pure logic for:

- collector-number normalization/parsing;
- pHash/Hamming operations;
- candidate score combination;
- confidence margin rules;
- language lexical scoring;
- Binder v2 migration.

### 21.4 Browser/mobile tests

Camera APIs are difficult to fully simulate, but browser tests should cover:

- upload path;
- scanner lazy loading;
- permission denied state;
- no camera available;
- cancellation/unmount stops tracks;
- result correction UI;
- multi-result selection;
- Binder add path.

For mobile interaction, follow the repository's existing discipline: use real touch-enabled browser contexts / `.tap()` where interaction semantics matter, not only a narrow viewport plus mouse clicks.

## 22. Failure modes the UX must handle

- no card detected;
- card partly outside frame;
- multiple overlapping cards;
- severe glare;
- card too small;
- OCR unavailable/worker load failure;
- scanner index unavailable;
- identity candidate tie;
- language uncertain;
- recognized blueprint exists but no current listing in detected language;
- user denies camera permission;
- browser does not support requested camera constraints.

Every failure should degrade to upload/manual correction rather than a dead end where possible.

## 23. Dependency policy

Do not add OpenCV.js/Tesseract.js/image hashing libraries to production merely because this architecture names them.

M1 should answer:

- what exact library produces acceptable fingerprints;
- whether OpenCV.js is required for all geometry or a lighter implementation is enough;
- whether Tesseract.js startup/accuracy is acceptable;
- what minimum language models are needed.

Only then lock versions and update package/requirements files.

## 24. Milestone plan

### M1 — recognition spike

Deliverables:

- minimal scanner-index builder for a controlled catalog subset;
- cropped-card recognition CLI/test harness or isolated browser harness;
- top-K candidate output with raw scores;
- fixture corpus;
- measured Top-1/Top-3/confident-error rates;
- written go/no-go conclusion.

No production `/scan` UI required.

### M2 — single-card upload

Deliverables:

- `/scan` route;
- image upload + drag/drop;
- automatic single-card geometry/crop;
- recognition result;
- ambiguity alternatives;
- link to existing card detail;
- existing price data shown through reused code.

No Binder v2 requirement yet.

### M3 — mobile camera

Deliverables:

- `getUserMedia` rear camera;
- capture lifecycle and cleanup;
- mobile framing UI;
- real-device/touch validation;
- graceful permission/error states.

### M4 — language + language-specific market data

Deliverables:

- independent language classifier;
- language confidence;
- integration with existing listing filters/prices;
- correct no-listing-in-language behavior.

### M5 — multi-card batch

Deliverables:

- multiple rectangle detection;
- bounded recognition/OCR queue;
- streaming result list;
- per-card correction;
- select/add-all preparation.

### M6 — Binder v2

Deliverables:

- quantity/language-aware local persistence;
- tested migration from legacy Binder;
- scanner single-add and bulk-add;
- normal Binder views updated without regressions.

## 25. Suggested M1 experiment matrix

Claude should start with a small but adversarial benchmark instead of many easy cards.

Suggested groups:

1. 10 cards with highly distinctive artwork;
2. 10 cards where the same Pokémon appears in many sets;
3. 10 full-art/illustration cards with large artwork area;
4. 10 older/standard-layout cards where text/layout dominates more;
5. same physical artwork photographed in IT/EN where possible;
6. sleeve/glare variations of at least 10 cards.

For every fixture, record expected `blueprint_id` and language separately.

Compare at least:

- full pHash only;
- artwork pHash only;
- weighted full + artwork;
- visual + collector-number OCR.

Do not add more complexity until this table shows where errors actually occur.

## 26. Open decisions to resolve with evidence

The following are intentionally not frozen yet:

- exact perceptual hash algorithm/library;
- fixed artwork crop vs card-layout-specific crop;
- scanner index JSON vs packed binary;
- exact OCR library and language packs;
- confidence weights/thresholds;
- whether blur/glare scoring is useful enough for V1;
- whether Binder `condition` belongs in the persisted aggregation key;
- whether scanner index generation runs in catalog sync or a separate workflow.

Claude should resolve each only after a small measurement/prototype, not by preference.

## 27. Explicit non-goals for first release

Do not conflate recognition with grading.

Out of scope:

- automatic Near Mint/Excellent/Good condition grading;
- centering/surface/corner grading;
- reliable foil/reverse-holo identification from a single arbitrary still;
- fake/counterfeit detection;
- price prediction;
- server-side image storage;
- continuous cloud vision inference.

These can become separate future projects after identity recognition is reliable.

## 28. Definition of done for the architecture phase

This architecture phase is complete when:

- issue #20 is the product source of truth;
- this document is merged after Claude review;
- issue #1 no longer claims the scanner is a separate deferred project;
- Claude begins with M1 instead of attempting the entire feature at once.

Implementation should remain milestone-based and reviewable. Each milestone should leave a measurable artifact/test before proceeding to the next.