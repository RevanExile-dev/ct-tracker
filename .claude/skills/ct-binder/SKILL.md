---
name: ct-binder
description: Use automatically for the personal binder/collection area: adding cards with the star, purchased versus found cards, acquisition price, P&L/delta, binder value/history charts, page layout, page flipping, collection interactions, and binder mobile UX.
---

# CT Tracker binder domain

- Preserve the distinction between cards that were purchased and cards that were found/opened.
- Purchased cards can have an acquisition cost and therefore a meaningful market delta/P&L.
- Found cards should not silently invent a purchase cost; where the product treats them as zero-cost, keep acquired-value analytics distinguishable from purchased-card P&L so totals are not misleading.
- Binder-wide value history and purchased-card performance are different analytics; do not collapse them without explicit product intent.
- Star-to-binder actions should remain fast and understandable; when metadata is needed, prefer the established modal/pop-up interaction pattern over hidden defaults.
- Binder presentation should feel like a collection/binder rather than a generic table while keeping card data readable and searchable.
- Page-flip/touch work must be verified with real gestures when possible and must not break scrolling or mobile navigation.
- Read the current implementation/schema before assuming older "lots" or localStorage behavior still exists.
