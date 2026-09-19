# Claude Code ↔ ChatGPT handoff protocol

This protocol lets Claude Code delegate scoped work to ChatGPT through GitHub without both agents editing the same branch or racing on `main`.

## Roles

- **Claude Code** is the primary coordinator and final integrator.
- **ChatGPT** handles only explicitly delegated tasks and review/fix loops on its own branches.
- **Gemini/Groq** remain read-only reviewers according to `CLAUDE.md`.

## How Claude delegates a task

Create a GitHub issue whose title starts with:

`[CHATGPT] <short task title>`

Use this body structure:

```md
## Objective
What must change.

## Context
Why it is needed and relevant current state.

## Acceptance criteria
- Concrete, testable criterion 1
- Concrete, testable criterion 2

## Scope / likely files
Files or areas ChatGPT may touch.

## Do not touch
Files/areas currently owned by Claude or otherwise off-limits.

## Base
Usually `main`, unless Claude explicitly requests another base.

## Notes
Anything else needed to avoid assumptions.
```

If the task is broad, ambiguous, or requires a product decision that is not specified, ChatGPT must not guess. It comments that the task is blocked and waits for Claude/user clarification.

## Ownership rules

1. Claude and ChatGPT never work on the same task branch.
2. ChatGPT never pushes to `main` and never pushes to a `claude/*` branch.
3. For issue `#N`, ChatGPT creates a branch named `chatgpt/issue-N-<slug>` from the requested base.
4. Claude should not edit a `chatgpt/*` branch directly. Requested changes go in PR comments/review threads.
5. ChatGPT opens a **draft PR** to the requested base and never merges it automatically.
6. Final merge/integration belongs to Claude or the user.

## Claiming and duplicate prevention

Before starting, ChatGPT checks whether the issue already has an active `chatgpt/issue-N-*` branch/PR or a claim marker.

When it starts, it comments:

`<!-- chatgpt-claimed --> Claimed by ChatGPT automation. Work branch: chatgpt/issue-N-<slug>.`

If the issue is already claimed or has a non-closed ChatGPT PR, it must not start duplicate work.

## Work loop

For an actionable delegated issue ChatGPT should:

1. Read the issue and the current requested base.
2. Check current open PRs/branches so it does not collide with Claude's active work.
3. Before every write/push, check GitHub Actions for in-progress sync workflows as required by `CLAUDE.md`; if a sync is running, defer the write rather than racing it.
4. Create its own `chatgpt/issue-N-*` branch.
5. Implement the smallest coherent diff that satisfies the acceptance criteria.
6. Search for the same bug/pattern in sibling states/components where relevant, following the verification discipline in `CLAUDE.md`.
7. Run available build/typecheck/tests and relevant browser checks when feasible.
8. Inspect the diff before opening/updating the PR.
9. Open a draft PR and link the issue.
10. Comment on the issue with the PR number, checks run, and any limitation that was not actually verified.

## Claude review → ChatGPT revision

Claude can request another pass by commenting on the ChatGPT PR. A revision request should start with either:

`[CHATGPT-REVISION]`

or clearly reference the delegated issue and concrete requested changes.

On a later scan, ChatGPT updates the same branch/PR, re-runs relevant checks, and replies to the review. It does not open a second PR for the same issue unless Claude explicitly asks for one.

## Stop conditions

ChatGPT must stop and ask through the issue/PR instead of guessing when:

- the task conflicts with a currently active Claude-owned branch or PR;
- the requested base has moved in a way that makes the task unsafe to apply without re-evaluation;
- acceptance criteria are contradictory or missing for a consequential product decision;
- a required secret/service is unavailable;
- the change would require a destructive migration or a production operation not explicitly requested;
- verification fails and the cause cannot be resolved safely within the delegated scope.

## Hourly automation behavior

The scheduled ChatGPT pickup should be **metadata-first and quiet**:

1. Search only for open `[CHATGPT]` issues and unresolved revision requests on existing `chatgpt/*` PRs.
2. If nothing actionable exists, stop immediately and do not notify the user.
3. Only when actionable work exists should it read the needed issue, files, diff, tests, and repository context.
4. Never perform a merge or direct `main` write from the automation.

This keeps coordination cheap while preserving a clear GitHub audit trail.
