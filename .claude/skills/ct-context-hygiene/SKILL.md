---
name: ct-context-hygiene
description: Use automatically when editing CLAUDE.md, AGENTS.md, Claude agents/skills/rules, or when project instructions/context are becoming large or duplicated. Applies context-budget principles without installing ECC: keep always-loaded text minimal and move conditional knowledge into auto-routed skills.
---

# CT Tracker context hygiene

- Keep always-loaded rules limited to truly global constraints, routing policy, and safety.
- Put domain knowledge in skills so the full body loads only when relevant.
- Keep subagent and skill descriptions short but discriminative; descriptions are always visible to the router.
- Do not duplicate long incident histories in multiple instruction files. Keep the durable rule and link to history/evidence.
- Prefer one canonical owner for architecture/status statements.
- Before adding a new skill, check whether an existing skill can own the knowledge cleanly.
- Before adding a new agent, check whether the need is a new execution capability/model/tool boundary rather than merely another topic; topics usually belong in skills.
- Preserve enough context to explain non-obvious safety rules. Token savings must not remove the reason needed to apply a rule correctly.
