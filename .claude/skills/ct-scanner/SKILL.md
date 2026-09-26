---
name: ct-scanner
description: Use automatically for CT Tracker Pokemon card recognition, visual matching, image index generation, recognition failures, scanner page UX, index rebuilds/backfills, accuracy, or performance work.
---

# CT Tracker card-recognition domain

- Read current recognition/index architecture docs and live code before changing matching logic.
- Reproduce recognition failures with the provided card input when available; one failed card is evidence to inspect the failure class, not a reason to overfit one example.
- Separate image preprocessing, candidate retrieval/index quality, similarity/ranking, and UI presentation when diagnosing misses.
- Measure before/after behavior on representative positives and obvious negatives when changing thresholds or ranking.
- Keep production index lifecycle in view: correct source code does not prove a rebuilt index is live.
- `build_scanner_index.yml` can write generated index data back to `main`; check active runs/concurrency before Git integration that could conflict with it.
- Do not claim recognition success from isolated logic when the real index path was not exercised.
