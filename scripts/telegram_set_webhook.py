"""
Strumento manuale una tantum (o da rilanciare a mano se il dominio o il
secret cambiano): registra su Telegram l'URL del webhook usato per il
collegamento account<->chat (punto 4a del piano,
docs/binder_reserved_work_plan_2026-09-11.md) - web/app/api/telegram/webhook/route.ts
lato Vercel. Non gira in nessun workflow GitHub Actions: setWebhook va
richiamato solo quando cambia l'URL o il secret, non ad ogni deploy.

Richiede TELEGRAM_BOT_TOKEN (lo stesso gia' usato da scripts/notify_telegram.py)
e un NUOVO secret TELEGRAM_WEBHOOK_SECRET (stringa casuale a scelta, es.
`python -c "import secrets; print(secrets.token_hex(32))"`) - deve essere
IDENTICO al valore impostato come variabile d'ambiente Vercel del progetto
web/ (TELEGRAM_WEBHOOK_SECRET), altrimenti web/app/api/telegram/webhook/route.ts
rifiuta ogni update con 401.

Uso:
  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \\
    python scripts/telegram_set_webhook.py https://tuo-dominio.vercel.app

Per verificare lo stato attuale del webhook (senza cambiarlo):
  TELEGRAM_BOT_TOKEN=... python scripts/telegram_set_webhook.py --info
"""
import os
import sys

import requests


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TELEGRAM_BOT_TOKEN non impostato.", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) == 2 and sys.argv[1] == "--info":
        resp = requests.get(f"https://api.telegram.org/bot{token}/getWebhookInfo", timeout=15)
        print(resp.json())
        return

    if len(sys.argv) != 2 or sys.argv[1].startswith("--"):
        print(__doc__)
        sys.exit(1)

    base_url = sys.argv[1].rstrip("/")
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET")
    if not secret:
        print("TELEGRAM_WEBHOOK_SECRET non impostato (deve combaciare con la variabile Vercel).", file=sys.stderr)
        sys.exit(1)

    webhook_url = f"{base_url}/api/telegram/webhook"
    resp = requests.post(
        f"https://api.telegram.org/bot{token}/setWebhook",
        json={"url": webhook_url, "secret_token": secret},
        timeout=15,
    )
    data = resp.json()
    if not resp.ok or not data.get("ok"):
        print(f"[ERRORE] setWebhook fallito: {resp.status_code} {data}", file=sys.stderr)
        sys.exit(1)
    print(f"Webhook registrato su {webhook_url}: {data}")


if __name__ == "__main__":
    main()
