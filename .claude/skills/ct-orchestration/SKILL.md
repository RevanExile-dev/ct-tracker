---
name: ct-orchestration
description: Automatically use for any CT Tracker request that asks to implement, fix, improve, refactor, investigate-and-change, or coordinate multiple code changes. Routes natural-language product requests to the cheapest appropriate explorer/executor/verifier while keeping Opus as coordinator and final judge.
user-invocable: false
---

# CT Tracker orchestration workflow

The user should never have to select an agent or skill.

## Route by work, not by file count

- Obvious/local implementation: delegate directly to `ct-code-executor` (Sonnet), then `ct-verifier` if behavior could regress.
- Unknown code surface or broad bug: first delegate repository discovery to `ct-explorer` (Haiku), then plan from its evidence.
- Complex/multi-domain task: use one or more read-only explorations where useful, create bounded units, serialize overlapping implementation, parallelize only independent units with `ct-parallel-executor`.
- Pure investigation with no requested changes: use `ct-explorer` and keep writes out.

## Main loop

1. Translate the user's product language into observable acceptance criteria.
2. Determine affected domains and let matching domain skills load automatically.
3. Gather only missing evidence; do not make Opus reread the whole repository when Haiku can scout it.
4. Delegate routine code writing to Sonnet.
5. Delegate independent verification to `ct-verifier`.
6. Opus compares evidence with the criteria and returns ACCEPT / REVISE / REPLAN.
7. Repeat only the failed portion, not the whole task.
8. Apply existing Gemini/Groq review + CI policy for significant changes.

Do not optimize merely for the number of agent calls. Optimize total context, correctness, and collision risk.
