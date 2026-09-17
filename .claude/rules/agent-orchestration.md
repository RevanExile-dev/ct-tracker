# Automatic Claude orchestration

These rules define the default Claude Code execution model for this repository. They are project-specific and take precedence over older coordination wording in `CLAUDE.md` when the topic is subagent routing/delegation. Existing safety, verification, GitHub review, and ChatGPT dispatch rules remain in force.

## User-facing contract

The user speaks in normal product language. Never require the user to know or select a skill, subagent, model, external executor, or command. Infer the domains involved, load relevant skills automatically, and choose the execution lane automatically.

Project settings start `ct-orchestrator` as the main thread. That agent runs **Opus** and intentionally cannot use `Write`, `Edit`, or `NotebookEdit`. Local Claude subagents have their own fixed model in `.claude/agents/`; invoking them is the routine model switch. ChatGPT Work is an external executor reached through permanent PR #6. Do not ask the user to run `/model` or manually choose Claude versus ChatGPT for routine work.

## Default routing

- `ct-orchestrator` (Opus): understand intent, make architectural/product decisions, decompose work, choose execution lanes/skills, integrate results, resolve conflicts, judge acceptance, and decide whether external review is needed.
- `ct-explorer` (Haiku): cheap read-only repository discovery, dependency tracing, locating files/patterns, and collecting evidence before implementation.
- `ct-code-executor` (Sonnet): default bounded implementation when the work is coupled to the current Claude session/worktree.
- `ct-parallel-executor` (Sonnet): genuinely independent local Claude implementation unit with worktree isolation.
- ChatGPT Work via PR #6: real external implementation lane for bounded independent work that can own its own `chatgpt/*` branch and Draft PR. Prefer it when offloading substantial implementation/search can preserve Claude quota/context without creating ownership conflicts.
- `ct-verifier` (Sonnet): independent local verification after implementation, including review/verification of a ChatGPT Draft PR when appropriate. It does not edit code.
- Gemini/Groq: independent read-only review through the existing GitHub Actions workflow. They are not implementation lanes.

Do not maximize parallelism. Choose the smallest useful set of workers. Parallel workers are appropriate only when ownership is non-overlapping and the expected saved coordinator context outweighs dispatch/integration overhead.

## Execution loop

For substantive implementation/debug/refactor work:

1. Opus interprets the product request, identifies domains/risk, and defines acceptance criteria.
2. Use Haiku exploration when repository discovery would otherwise consume meaningful Opus context. Skip it for obvious/local changes.
3. Opus decomposes only as far as needed and assigns ownership:
   - coupled/current-worktree implementation -> Sonnet `ct-code-executor`;
   - independent local Claude unit -> Sonnet `ct-parallel-executor`;
   - independent external unit with clear scope/acceptance criteria -> ChatGPT Work via PR #6 and `ct-chatgpt-dispatch`.
4. Executors implement. Opus does not duplicate their implementation.
5. Sonnet verifier runs relevant real checks or evaluates the resulting branch/PR. ChatGPT-owned work remains on its Draft PR until reviewed/integrated.
6. Opus judges: ACCEPT, REVISE, or REPLAN.
7. On REVISE, send the failed criteria back to the implementation owner. For ChatGPT-owned work, use the existing `[CHATGPT-REVISION]` protocol rather than creating a competing Claude implementation.
8. For significant work, use Gemini/Groq final review and existing CI/merge safeguards from `CLAUDE.md`.

For a tiny change, do not invoke Haiku, ChatGPT, multiple workers, and multiple reviews just to follow a diagram. Route directly to the cheapest sufficient execution path and verify proportionally.

## Claude-usage optimization

The target is **less expensive Claude context/quota per completed, verified task**, not fewer tokens across every provider combined.

- Keep Opus focused on high-value reasoning, decomposition, conflict resolution, and acceptance. Do not make Opus read large logs or perform routine implementation.
- Use Haiku for search/discovery only when it avoids meaningful Opus context growth.
- Use Sonnet for normal coding and executable verification.
- Use ChatGPT for suitable independent implementation so those implementation tokens do not consume Claude quota. Opus should receive a compact task result plus the actual diff/PR evidence, not replay the entire ChatGPT working history.
- Keep skill bodies concise and auto-load only relevant domains.
- Do not spawn agents for work whose coordination overhead exceeds the saved context.
- Measure the result using Claude Code `/usage` and `/context` before claiming the architecture is cheaper in practice.

## ChatGPT dispatch ownership

Before dispatching ChatGPT:

- Follow `docs/multi_ai_coordination.md` and the `ct-chatgpt-dispatch` skill.
- Check that an equivalent ChatGPT task/PR is not already active.
- Define Objective, Context, Acceptance criteria, Scope/likely files, Do not touch, and Base branch.
- Reserve non-overlapping ownership. Claude/Sonnet must not concurrently edit the same files/task.
- Post `[CHATGPT]` only to permanent PR #6; ChatGPT implements on its own `chatgpt/*` branch/Draft PR, never on `coord/chatgpt-dispatch` or `main`.
- Treat ChatGPT's completion as candidate implementation, not automatic acceptance. Inspect the diff and evidence, verify, then integrate through normal safeguards.

## Skills

Skills under `.claude/skills/` are auto-routed by their descriptions. Do not preload every domain skill into every agent. Load only the skills relevant to the current request. Agents may invoke additional skills during execution when the discovered code reveals another domain.

## Parallelism and worktrees

Parallelize only independent units with non-overlapping ownership. Use `ct-parallel-executor` for local Claude units that need isolation. Its isolated worktree branches from current `HEAD` because project settings use `worktree.baseRef: head`.

When integrating isolated-agent or ChatGPT work, the coordinator must inspect the actual diff/test evidence before cherry-picking, merging, or otherwise integrating it. Never run two write-capable agents concurrently against the same working tree or overlapping files.

The normal `ct-code-executor` intentionally shares the current task worktree: it is serialized and the coordinator is not writing concurrently, which keeps integration simple.

## Verification truthfulness

Implementation and verification are separate states. Never claim a browser, database, sync, CI, or device interaction was verified unless it was actually executed and its result observed. Follow the repository's existing discipline in `CLAUDE.md` and `AGENTS.md`, including all UI states and same-pattern searches.

## Safety boundary

Automatic reasoning/routing is allowed; irreversible or production-impacting actions still follow existing repository rules. Do not treat a skill or executor result as authorization to bypass merge/deploy/database/secrets safeguards. Never expose secrets. For security-sensitive changes, inspect first and change only what the task actually authorizes.

## Source-of-truth hygiene

For current technical truth prefer, in order: live code/config on the target branch, current `AGENTS.md`/project rules, domain docs that match the live code, then historical issues/notes. GitHub issue #1 is useful history but may lag the current architecture; do not let stale status text override live Postgres/Next.js implementation.
