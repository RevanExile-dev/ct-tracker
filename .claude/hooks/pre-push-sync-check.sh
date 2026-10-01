#!/bin/bash
# Blocca un `git push` su main mentre build_scanner_index.yml (contents:write,
# commit/push automatico su main) e' in_progress - l'errore reale gia'
# commesso due volte in questa repo (vedi CLAUDE.md, "Disciplina di
# verifica", punto 4). I sync Postgres (sync_prices*/sync_catalog) non
# scrivono piu' su git da PR #29 e non sono bloccanti.
set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Solo un vero `git push`.
if ! echo "$command" | grep -qE '(^|[;&|]|&&)\s*git\s+push\b'; then
  exit 0
fi

# Solo se il push riguarda main (esplicito nel comando, o branch corrente).
branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$command" != *"main"* && "$branch" != "main" ]]; then
  exit 0
fi

runs=$(curl -sS --max-time 10 \
  "https://api.github.com/repos/RevanExile-dev/ct-tracker/actions/workflows/build_scanner_index.yml/runs?status=in_progress&per_page=1" \
  2>/dev/null || echo '{}')
count=$(echo "$runs" | jq -r '.total_count // 0' 2>/dev/null || echo 0)

if [ "$count" -gt 0 ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "build_scanner_index.yml e in_progress (contents:write, fa commit+push automatico su main) - aspetta che finisca prima di pushare su main, per evitare il conflitto gia successo due volte in passato (vedi CLAUDE.md, Disciplina di verifica #4)."
    }
  }'
else
  exit 0
fi
