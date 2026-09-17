---
name: ct-data-pricing
description: Use automatically for CT Tracker PostgreSQL, APIs, persistence, CardTrader catalog/prices, price history, sync scripts/workflows, binder data, watchlist data, release tracking, or any bug involving missing/stale/wrong market data.
---

# CT Tracker data, pricing, and sync domain

- Current architecture is Postgres/server API based. Do not resurrect old sql.js/browser-database assumptions.
- Trace data end to end: upstream/CardTrader -> Python sync -> Postgres -> Next.js Route Handler/server query -> client UI.
- Distinguish catalog completeness from price completeness and current price from history.
- Preserve idempotency in sync/upsert paths and validate conflict/update behavior before assuming re-sync is unsafe.
- For missing data, determine whether the gap is upstream availability, tracked-set configuration, sync eligibility, DB state, API filtering, or UI filtering.
- Avoid destructive DB operations. Production-impacting data changes require explicit evidence and existing repository safeguards.
- Existing sync workflows no longer all write Git; consult the live workflow/script before applying old concurrency assumptions. `build_scanner_index.yml` is a known special case that can write to `main`.
- Validate date/release-window logic against explicit dates and boundary cases.
