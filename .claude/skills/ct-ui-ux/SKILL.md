---
name: ct-ui-ux
description: Use automatically for CT Tracker frontend and UX work involving responsive layouts, mobile or touch behavior, card interactions, animations, transitions, accessibility, home, catalog, detail pages, or binder presentation.
---

# CT Tracker UI and UX

- Treat one visible failure as a sample of a possible repeated pattern and search sibling components.
- Preserve functionality and data semantics while changing presentation.
- Check normal, loading, empty, and error states when present.
- Mobile verification requires real touch, scroll, or gesture behavior when interaction changes, not only a narrow viewport.
- Prefer native browser interaction and accessible controls before custom gesture machinery.
- For animations, preserve responsiveness and reduced-motion accessibility, and avoid blocking data interaction.
- Reuse existing design primitives before adding another parallel component system.
- Verify objective regressions such as overflow, clipping, hit targets, scrolling, keyboard behavior, loading layout, and performance hotspots.
