#!/bin/bash
# Dopo ogni Edit/Write su un file sotto web/, lancia eslint --fix su quel
# file soltanto (non l'intero progetto). Silenzioso a meno che non corregga
# davvero qualcosa - eslint scrive il report su stdout (non stderr), quindi
# va confrontato il contenuto prima/dopo invece di limitarsi a sopprimere
# stderr.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
file=$(echo "$input" | jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null || echo "")

case "$file" in
  */web/*.ts|*/web/*.tsx|*/web/*.js|*/web/*.jsx|*/web/*.mjs)
    if [[ "$file" == */node_modules/* || "$file" == */.next/* ]]; then
      exit 0
    fi
    if [ ! -d "$CLAUDE_PROJECT_DIR/web/node_modules" ]; then
      exit 0
    fi
    before=$(md5sum "$file" 2>/dev/null | cut -d' ' -f1)
    (cd "$CLAUDE_PROJECT_DIR/web" && npx eslint --fix "$file") >/dev/null 2>&1 || true
    after=$(md5sum "$file" 2>/dev/null | cut -d' ' -f1)
    if [ "$before" != "$after" ]; then
      echo "eslint --fix ha corretto $file"
    fi
    ;;
esac
exit 0
