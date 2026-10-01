#!/bin/bash
# Blocca un `git push` su main mentre build_scanner_index.yml (contents:write,
# commit/push automatico su main) e' in_progress - l'errore reale gia'
# commesso due volte in questa repo (vedi CLAUDE.md, "Disciplina di
# verifica", punto 4). I sync Postgres (sync_prices*/sync_catalog) non
# scrivono piu' su git da PR #29 e non sono bloccanti.
#
# Nota: la query GitHub API e' senza token - va bene perche' questo repo e'
# intenzionalmente pubblico (vedi issue #1); su un repo privato questa
# chiamata tornerebbe 401 e lo script fallirebbe "aperto" (non blocca).
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

# Un vero `git push`, ovunque compaia nel comando (anche dopo `sudo`, in una
# subshell, ecc.) - i falsi positivi qui costano solo una query in piu' a
# un'API pubblica, non sono pericolosi; un falso negativo invece vanificherebbe
# l'hook.
if ! echo "$command" | grep -qE '\bgit[[:space:]]+push\b'; then
  exit 0
fi

# Solo se il push riguarda main (branch corrente, o "main" come parola
# intera nel comando - non una substring, altrimenti "maintenance" o simili
# farebbero scattare un blocco ingiustificato).
branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if ! [[ "$command" =~ (^|[^a-zA-Z0-9_-])main($|[^a-zA-Z0-9_-]) ]] && [[ "$branch" != "main" ]]; then
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
  exit 0
fi

exit 0
