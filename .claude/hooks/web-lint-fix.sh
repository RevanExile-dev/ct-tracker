#!/bin/bash
# Dopo ogni Edit/Write su un file sotto web/, lancia eslint --fix su quel
# file soltanto (non l'intero progetto) - stile pulito senza doverci
# pensare a fine sessione.
set -euo pipefail

input=$(cat)
file=$(echo "$input" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')

case "$file" in
  */web/*.ts|*/web/*.tsx|*/web/*.js|*/web/*.jsx|*/web/*.mjs)
    if [[ "$file" == */node_modules/* || "$file" == */.next/* ]]; then
      exit 0
    fi
    if [ ! -d "$CLAUDE_PROJECT_DIR/web/node_modules" ]; then
      exit 0
    fi
    (cd "$CLAUDE_PROJECT_DIR/web" && npx eslint --fix "$file") 2>/dev/null || true
    ;;
esac
exit 0
