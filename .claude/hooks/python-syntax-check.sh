#!/bin/bash
# Dopo ogni Edit/Write su scripts/*.py, verifica subito che compili - invece
# di scoprire un errore di sintassi solo a fine sessione o in CI
# (ci_backend.yml fa lo stesso controllo con compileall, ma solo al push).
set -euo pipefail

input=$(cat)
file=$(echo "$input" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')

case "$file" in
  */scripts/*.py)
    err=$(python3 -m py_compile "$file" 2>&1) || {
      jq -n --arg reason "Errore di sintassi in $file:
$err" '{decision: "block", reason: $reason}'
      exit 0
    }
    ;;
esac
exit 0
