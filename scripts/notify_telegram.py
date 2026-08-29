"""
Manda una notifica Telegram quando una carta scende di prezzo, dopo un sync
prezzi. Due modalita' indipendenti:

1. Soglia generale: qualunque carta tracciata il cui calo rispetto al
   prezzo precedente supera DROP_THRESHOLD_PCT (default 15%).
2. Watchlist: le carte elencate in config/watchlist.json vengono sempre
   riportate con il loro prezzo attuale, a prescindere dalla soglia.

Non fa nulla (esce silenziosamente) se i secret TELEGRAM_BOT_TOKEN e
TELEGRAM_CHAT_ID non sono configurati: la funzione resta opzionale, il
resto della pipeline continua a funzionare senza.

Come attivarla:
1. Crea un bot con @BotFather su Telegram (gratis), copia il token
2. Scrivi un messaggio al tuo bot, poi apri
   https://api.telegram.org/bot<TOKEN>/getUpdates per trovare il tuo chat_id
3. Aggiungi TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID come Secret del repository
   (Settings -> Secrets and variables -> Actions)

Uso: python scripts/notify_telegram.py
"""
import json
import os
import sys
from pathlib import Path

import requests

import db

REPO_ROOT = Path(__file__).resolve().parent.parent
WATCHLIST_PATH = REPO_ROOT / "config" / "watchlist.json"
DROP_THRESHOLD_PCT = float(os.environ.get("DROP_THRESHOLD_PCT", "15"))
MAX_ITEMS_PER_SECTION = 15  # non spammare un messaggio infinito


def format_price(cents, currency):
    if cents is None:
        return "—"
    symbol = {"EUR": "€", "USD": "$", "GBP": "£"}.get(currency, currency or "")
    return f"{cents / 100:.2f}{symbol}"


def find_drops(conn, threshold_pct: float):
    rows = conn.execute(
        """
        SELECT b.id, b.name, b.expansion_name, lp.min_price_cents,
               lp.min_price_currency, lp.prev_price_cents
        FROM blueprints b
        JOIN latest_prices lp ON lp.blueprint_id = b.id
        WHERE lp.min_price_cents IS NOT NULL
          AND lp.prev_price_cents IS NOT NULL AND lp.prev_price_cents > 0
          AND lp.min_price_cents < lp.prev_price_cents
        """
    ).fetchall()
    drops = []
    for bp_id, name, expansion_name, price, currency, prev in rows:
        pct = (price - prev) / prev * 100
        if pct <= -threshold_pct:
            drops.append((bp_id, name, expansion_name, price, currency, prev, pct))
    drops.sort(key=lambda r: r[6])  # calo piu' grande prima (piu' negativo)
    return drops


def load_watchlist(conn):
    if not WATCHLIST_PATH.exists():
        return []
    ids = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8")).get("blueprint_ids", [])
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT b.id, b.name, b.expansion_name, lp.min_price_cents,
               lp.min_price_currency, lp.prev_price_cents
        FROM blueprints b
        LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
        WHERE b.id IN ({placeholders})
        """,
        ids,
    ).fetchall()
    return rows


def build_message(drops, watchlist_rows):
    if not drops and not watchlist_rows:
        return None

    lines = ["*📉 Aggiornamento prezzi CardTrader*", ""]

    if drops:
        lines.append(f"*Cali di oltre {DROP_THRESHOLD_PCT:.0f}%:*")
        for bp_id, name, expansion_name, price, currency, prev, pct in drops[:MAX_ITEMS_PER_SECTION]:
            lines.append(
                f"▼ {pct:.0f}% — *{name}* ({expansion_name}): "
                f"{format_price(prev, currency)} → {format_price(price, currency)}"
            )
        if len(drops) > MAX_ITEMS_PER_SECTION:
            lines.append(f"…e altre {len(drops) - MAX_ITEMS_PER_SECTION} carte.")
        lines.append("")

    if watchlist_rows:
        lines.append("*Carte nella tua watchlist:*")
        for bp_id, name, expansion_name, price, currency, prev in watchlist_rows:
            arrow = ""
            if price is not None and prev is not None and prev > 0:
                pct = (price - prev) / prev * 100
                arrow = f" ({'▼' if pct < 0 else '▲'} {abs(pct):.0f}%)" if pct != 0 else ""
            lines.append(f"• *{name}* ({expansion_name}): {format_price(price, currency)}{arrow}")

    return "\n".join(lines)


def send_telegram(token: str, chat_id: str, text: str):
    resp = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
        timeout=15,
    )
    if not resp.ok:
        print(f"[ATTENZIONE] Invio Telegram fallito: {resp.status_code} {resp.text}", file=sys.stderr)


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID non configurati: notifiche disattivate.")
        return

    conn = db.get_connection()

    drops = find_drops(conn, DROP_THRESHOLD_PCT)
    watchlist_rows = load_watchlist(conn)

    message = build_message(drops, watchlist_rows)
    if not message:
        print("Nessun calo di prezzo significativo oggi, nessuna notifica inviata.")
        return

    send_telegram(token, chat_id, message)
    print(f"Notifica Telegram inviata: {len(drops)} cali sopra soglia, "
          f"{len(watchlist_rows)} carte in watchlist.")


if __name__ == "__main__":
    main()
