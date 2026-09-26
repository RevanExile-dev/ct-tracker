# CT Tracker — Claude auto-orchestration

This document explains the project-scoped Claude Code architecture. The user does not need to invoke agents or skills manually.

## Goal

A natural-language product request such as "make the binder feel more real, improve page flipping, and fix the value chart" should be routed automatically into the appropriate knowledge and execution layers while conserving the Opus coordinator's context.

## Runtime architecture

```text
User request in natural language
          |
          v
Main Claude thread: OPUS
intent / product decisions / decomposition / acceptance criteria
          |
          +--> CT skills auto-load by description (binder, UI, data, scanner, ...)
          |
          +--> ct-explorer: HAIKU, read-only discovery when needed
          |
          v
Implementation
          |
          +--> ct-code-executor: SONNET, default serialized writer
          |
          +--> ct-parallel-executor: SONNET + isolated worktree
               only for independent units
          |
          v
ct-verifier: SONNET, read-only verification
          |
          v
Main OPUS judge: ACCEPT / REVISE / REPLAN
          |
          +--> existing Gemini/Groq independent review when required
          +--> existing GitHub CI
          +--> existing ChatGPT PR #6 delegation remains available
```

There is no Fable dependency. Opus is the strongest coordinator available to this setup.

## How automatic model routing works

Claude Code does not change the main thread model when code is encountered. Instead, the main Opus thread delegates a task to a custom agent. Each agent pins its own model in YAML frontmatter:

- `ct-explorer` -> `model: haiku`
- `ct-code-executor` -> `model: sonnet`
- `ct-parallel-executor` -> `model: sonnet`
- `ct-verifier` -> `model: sonnet`

Claude chooses whether to invoke an agent from its `description`; when invoked, that task runs in the agent's separate context on the configured model. The main conversation stays Opus.

This means "automatic switching" is delegation, not mutation of one conversation from Opus to Sonnet.

## Skills versus agents

Agents define **who/how the work is executed**: model, context, write boundary, isolation, verification role.

Skills define **what domain knowledge should be loaded**. The initial set is:

- `ct-orchestration`: route implementation/fix/refactor work.
- `ct-ui-ux`: frontend, visual, responsive, touch, animation.
- `ct-binder`: personal collection, acquisition cost/P&L/history/page-flip semantics.
- `ct-data-pricing`: Postgres, CardTrader, sync, prices, APIs, persistence.
- `ct-scanner`: visual card recognition/index lifecycle.
- `ct-verification`: repository verification discipline.
- `ct-doc-governance`: prevent contradictory/stale living docs.
- `ct-context-hygiene`: context-budget principles, keep global instructions lean.
- `ct-security`: secrets, permissions, automation/deployment trust boundaries.

Skill descriptions are visible to the router; full bodies load only when relevant. New topics should normally become skills, not new agents. Add a new agent only when a genuinely different model/tool/permission/isolation boundary is useful.

## Default decision policy

### Small obvious change

Opus defines the expected result -> Sonnet executor implements -> Sonnet verifier if behavior can regress -> Opus judges.

Do not spend a Haiku call just to find an obvious file.

### Broad/uncertain bug

Haiku explores the pattern and affected surfaces -> Opus selects root cause/scope -> Sonnet implements -> Sonnet verifies -> Opus judges.

### Multi-part feature

Opus decomposes. Overlapping units are serialized through the default executor. Truly independent units can use separate `ct-parallel-executor` instances. Each isolated result must be inspected before integration.

### Investigation only

Haiku explores and reports. No writer is needed unless the user also requested a change.

## Worktree policy

The project setting uses `worktree.baseRef: head`, so isolated subagents inherit the current task branch/commit state instead of unexpectedly starting from remote `main`.

The default Sonnet executor intentionally does **not** create another worktree: it is the sole writer inside the already-isolated task worktree and the Opus coordinator is not supposed to edit concurrently. This minimizes integration overhead.

The parallel executor has `isolation: worktree` because its purpose is concurrent independent work. Never use parallel writers on overlapping files.

`.claude/worktrees/` is gitignored.

## Verification and external review

The Sonnet verifier is not a replacement for existing CT Tracker safeguards. It creates separation between writer and verifier inside Claude. Existing layers remain:

1. focused tests/build/lint/application evidence;
2. independent Sonnet verifier;
3. Opus final judgment;
4. Gemini/Groq GitHub Actions review for significant/risky work as defined in `CLAUDE.md`;
5. CI and the repository's existing merge rules.

ChatGPT Work/Codex delegation through PR #6 also remains unchanged. It is a separate external implementation channel, not a Claude subagent.

## What was deliberately not added

- No ECC package installation.
- No third-party hooks.
- No automatic formatter/typecheck hooks after every edit.
- No global `~/.claude` configuration: everything here is repository-scoped.
- No automatic production deploy, destructive DB action, secret management, or unconditional merge mechanism.
- No blanket parallelism: parallel agents are used only when independence is established.

The useful ideas from ECC are represented natively: progressive disclosure through skills, context hygiene, living-document governance, worktree lifecycle/isolation, and security-aware automation boundaries.

## Source-of-truth rule

Live code/config and executable evidence outrank status prose. `CLAUDE.md` and `AGENTS.md` remain core repository instructions; `.claude/rules/agent-orchestration.md` is authoritative for the new automatic routing/delegation policy. Historical issue #1 can provide recovery history but must not override the current Postgres/Next.js implementation.

## How to observe it

When Claude Code delegates, use `/tasks` to see running subagents and the model used by each. `/agents` lists the project agents. Skills should normally trigger without user involvement; explicit slash invocation remains useful only for debugging their routing.
