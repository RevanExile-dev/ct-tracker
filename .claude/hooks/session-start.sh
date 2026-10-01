#!/bin/bash
set -euo pipefail

# Solo nelle sessioni cloud di Claude Code: in locale lo sviluppatore
# gestisce le proprie dipendenze come preferisce.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "Installo le dipendenze Python (scripts/, requirements.txt)..."
pip install -q -r "$CLAUDE_PROJECT_DIR/requirements.txt"

echo "Installo le dipendenze del frontend (web/, package.json)..."
cd "$CLAUDE_PROJECT_DIR/web"
npm install
