---
name: ct-verification
description: Use automatically after CT Tracker code changes to verify acceptance criteria with available build, lint, tests, Playwright, application checks, UI states, and regression searches, and to report PASS, FAIL, or NOT VERIFIED honestly.
---

# CT Tracker verification

- Map each check to an observable acceptance criterion.
- Run focused deterministic checks before broader integration checks.
- For frontend work, use the relevant lint/build and interaction checks.
- For Python work, use syntax/static checks and focused behavior checks.
- Check normal, loading, empty, and error states when they exist.
- Check mobile interaction with real touch or gesture behavior when that behavior changed.
- After correcting a structural pattern, search for sibling occurrences.
- Record exact checks and observed results.
- Never turn an unavailable or skipped check into a pass.
- Gemini/Groq review complements verification; it does not replace executable checks.
