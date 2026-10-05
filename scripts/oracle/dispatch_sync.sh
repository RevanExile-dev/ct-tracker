#!/usr/bin/env bash
# Lancia il workflow "Sync prezzi carte tracciate" su GitHub tramite API
# (workflow_dispatch), ogni 15 minuti da cron sulla VM Oracle. Il lavoro vero
# lo esegue poi il runner self-hosted sulla stessa VM: qui parte solo il
# "via". Non dipende dai cron di GitHub, che saltano spesso gli avvii.
#
# Token: file /etc/ct-tracker/dispatch.env (solo root/proprietario, chmod 600)
# con una riga:  GH_DISPATCH_TOKEN=github_pat_...
# (token fine-grained limitato a questo solo repo, permesso "Actions: write").
set -euo pipefail

ENV_FILE="${CT_DISPATCH_ENV:-/etc/ct-tracker/dispatch.env}"
REPO="RevanExile-dev/ct-tracker"
WORKFLOW="sync_prices_priority.yml"

# shellcheck disable=SC1090
source "$ENV_FILE"

status=$(curl -sS -o /tmp/ct_dispatch_out.txt -w '%{http_code}' \
  --max-time 20 \
  -X POST \
  -H "Authorization: Bearer ${GH_DISPATCH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches" \
  -d '{"ref":"main"}')

# GitHub risponde 204 (o 200) quando accetta la richiesta.
if [ "$status" != "204" ] && [ "$status" != "200" ]; then
  echo "$(date -u +%FT%TZ) dispatch fallito, HTTP $status: $(head -c 300 /tmp/ct_dispatch_out.txt)" >&2
  exit 1
fi
echo "$(date -u +%FT%TZ) dispatch ok (HTTP $status)"
