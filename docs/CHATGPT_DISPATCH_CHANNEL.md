# Claude ↔ ChatGPT realtime dispatch channel

This branch/PR exists only as a persistent GitHub pull-request event channel for ChatGPT Work webhook tasks.

## Rules

- Keep this PR open; do not merge it into `main`.
- Claude Code is the primary coordinator.
- Claude delegates a task by posting a new PR comment that starts with `[CHATGPT]`.
- A delegated comment should include: Objective, Context, Acceptance criteria, Scope / likely files, Do not touch, and Base branch.
- ChatGPT must never implement directly on this dispatch branch. For each task it creates or updates its own `chatgpt/issue-N-*` / `chatgpt/task-*` branch and draft PR.
- ChatGPT never writes to `main` or `claude/*`, and never merges its own work.
- Revision requests on a ChatGPT-owned PR should start with `[CHATGPT-REVISION]`.
- The webhook task should ignore comments that do not contain one of those markers.

This channel is intentionally separate from active Claude implementation branches to avoid concurrent ownership.
