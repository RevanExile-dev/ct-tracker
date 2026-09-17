# Automatic Claude orchestration

These rules define the default Claude Code execution model for this repository. They are project-specific and take precedence over older coordination wording in `CLAUDE.md` when the topic is subagent routing/delegation. Existing safety, verification, GitHub review, and ChatGPT dispatch rules remain in force.

## User-facing contract

The user speaks in normal product language. Never require the user to know or select a skill, subagent, model, or command. Infer the domains involved, load relevant skills automatically, and delegate automatically when useful.

The project setting starts the main Claude Code thread on **Opus**. Treat that main thread as the coordinator/judge, not the default code typist. Subagents have their own fixed model in `.claude/agents/`; invoking them is the model switch. Do not ask the user to run `/model` for routine delegation.

## Default routing

- Main Opus: understand intent, make architectural/product decisions, decompose work, choose agents/skills, integrate results, resolve conflicts, judge acceptance, and decide whether external review is needed.
- `ct-explorer` (Haiku): cheap read-only repository discovery, dependency tracing, locating files/patterns, and collecting evidence before implementation.
- `ct-code-executor` (Sonnet): default bounded implementation agent. Only one write-capable executor may modify the current task worktree at a time.
- `ct-parallel-executor` (Sonnet): only for genuinely independent implementation units. It is worktree-isolated; do not use it merely because a task is large.
- `ct-verifier` (Sonnet): independent verification after implementation. It does not edit code; failures return to the coordinator/executor loop.
- Gemini/Groq review through the existing GitHub Actions workflow remains an independent external review layer. Do not replace it with a Claude self-review.
- ChatGPT dispatch through permanent PR #6 remains available for bounded independent delegated work. Do not duplicate or replace that transport here.

## Execution loop

For substantive implementation/debug/refactor work, prefer:

1. Opus interprets the product request and identifies domains/risk.
2. Use Haiku exploration when repository discovery would otherwise consume meaningful Opus context. Skip this step for obvious/local changes.
3. Opus creates a bounded implementation plan and acceptance criteria.
4. Sonnet executor implements. Opus should not independently duplicate the same implementation.
5. Sonnet verifier runs the relevant real checks and reports observed evidence without fixing failures.
6. Opus judges: ACCEPT, REVISE, or (when scope is wrong) REPLAN.
7. On REVISE, send concrete failed criteria back to an executor; then verify again.
8. For significant work, use the existing Gemini/Groq final review and CI rules from `CLAUDE.md` before completion/merge.

Opus may make a tiny direct edit when delegation would cost more context/coordination than the edit itself (for example a one-line typo or orchestration metadata), or when subagents are unavailable. This is the exception, not the default for product code.

## Skills

Skills under `.claude/skills/` are auto-routed by their descriptions. Do not preload every domain skill into every agent. Load only the skills relevant to the current request. Agents may invoke additional skills during execution when the discovered code reveals another domain.

## Parallelism and worktrees

Parallelize only independent units with non-overlapping ownership. Use `ct-parallel-executor` for those units. Its isolated worktree branches from current `HEAD` because project settings use `worktree.baseRef: head`.

When integrating isolated-agent work, the coordinator must inspect the actual diff/test evidence before cherry-picking or otherwise integrating it. Never run two write-capable agents concurrently against the same working tree or overlapping files.

The normal `ct-code-executor` intentionally shares the current task worktree: it is serialized and the coordinator is not writing concurrently, which keeps integration simple.

## Verification truthfulness

Implementation and verification are separate states. Never claim a browser, database, sync, CI, or device interaction was verified unless it was actually executed and its result observed. Follow the repository's existing discipline in `CLAUDE.md` and `AGENTS.md`, including all UI states and same-pattern searches.

## Safety boundary

Automatic reasoning/routing is allowed; irreversible or production-impacting actions still follow existing repository rules. Do not treat a skill or subagent result as authorization to bypass merge/deploy/database/secrets safeguards. Never expose secrets. For security-sensitive changes, inspect first and change only what the task actually authorizes.

## Source-of-truth hygiene

For current technical truth prefer, in order: live code/config on the target branch, current `AGENTS.md`/project rules, domain docs that match the live code, then historical issues/notes. GitHub issue #1 is useful history but may lag the current architecture; do not let stale status text override live Postgres/Next.js implementation.
