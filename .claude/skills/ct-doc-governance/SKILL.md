---
name: ct-doc-governance
description: Use automatically when changing CT Tracker architecture, workflows, agent instructions, project status, setup, or documentation that can become a source of truth. Prevent contradictory docs and keep stable rules, current maps, status, and history clearly separated.
---

# CT Tracker living documentation governance

- Do not create a second canonical document for information that already has an owner.
- Stable rules belong in `CLAUDE.md`, `AGENTS.md`, or project rules; task/domain procedures belong in skills; dynamic evidence belongs in code, GitHub, tests, and CI.
- Architecture docs should describe the current system, not preserve obsolete implementation as if current.
- Historical issues/notes may explain why a decision happened but must not override live code/config.
- When a change invalidates a documented statement, update the owning document in the same work when practical.
- Prefer links/references over duplicating long instructions in multiple files.
- Keep agent/skill descriptions short; move detail into bodies that load only when relevant.
- If two sources disagree, identify the contradiction explicitly and reconcile it rather than silently choosing whichever is convenient.
