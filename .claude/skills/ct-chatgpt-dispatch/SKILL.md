---
name: ct-chatgpt-dispatch
description: Use automatically when CT Tracker has a bounded implementation unit that can be delegated independently to ChatGPT Work through permanent PR #6, especially when doing so saves Claude context/quota. Covers ownership, dispatch format, duplicate checks, revision routing, and acceptance of the resulting Draft PR.
user-invocable: false
---

# CT Tracker ChatGPT operational dispatch

ChatGPT Work is an implementation executor, not a read-only reviewer. Transport is permanent PR #6 (`coord/chatgpt-dispatch`); implementation always happens on a separate `chatgpt/*` branch and Draft PR.

Use this lane when the unit is independently specifiable, has objective acceptance criteria, can own non-overlapping files/work, and is substantial enough that offloading implementation/search is worth dispatch and integration overhead.

Do not use it for tiny changes, tightly coupled edits already owned by the active Claude worktree, production/destructive operations, or when an equivalent ChatGPT task/PR is already active.

Before dispatch:

1. Read/follow `docs/multi_ai_coordination.md` and current PR #6 rules.
2. Check active ChatGPT PRs/tasks for duplicates and ownership conflicts.
3. Freeze a compact delegation packet containing: Objective, necessary Context, Acceptance criteria, Scope / likely files, Do not touch, Base branch, and verification expectations.
4. Post that packet as a new PR #6 comment beginning `[CHATGPT]`.
5. Do not have Sonnet/Claude concurrently implement the same unit or modify the same owned files.

When ChatGPT returns a Draft PR:

- Inspect the actual diff and reported verification; do not trust the summary alone.
- Use `ct-verifier` or appropriate existing CI/real-environment checks.
- If revision is needed, keep ownership with ChatGPT and send `[CHATGPT-REVISION]` according to the existing protocol rather than starting a competing implementation.
- Only after verification should Opus accept/integrate the work using the repository's normal review/merge rules.

Keep the handoff minimal: provide enough context to execute correctly, but do not paste the whole Claude conversation. The point is to move operational context and token consumption out of the Opus main thread while preserving a concise, auditable contract in GitHub.
