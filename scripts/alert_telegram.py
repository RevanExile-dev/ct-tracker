#!/usr/bin/env python3
"""Manda un avviso Telegram al proprietario del sito (usato dai controlli).

Il bot e' lo stesso degli allarmi prezzo (TELEGRAM_BOT_TOKEN). La chat NON e'
un segreto del repository: gli allarmi vanno alla chat che l'utente ha
collegato dal sito (tabella telegram_links, sola lettura). Ordine di scelta:
1. TELEGRAM_CHAT_ID, se qualcuno lo imposta come segreto;
2. la chat collegata all'account con email ALERT_EMAIL (segreto/variabile);
3. la chat collegata per prima (il proprietario collega il bot per primo).
Uso: alert_telegram.py "testo"   (variabili: TELEGRAM_BOT_TOKEN, POSTGRES_URL)
Esce con 0 anche se non riesce a inviare: l'avviso non deve nascondere il
vero errore del controllo.
"""
import os
import sys

import requests


def pick_chat_id():
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if chat:
        return chat, "segreto TELEGRAM_CHAT_ID"
    import psycopg2

    conn = psycopg2.connect(os.environ["POSTGRES_URL"])
    try:
        cur = conn.cursor()
        email = os.environ.get("ALERT_EMAIL")
        if email:
            cur.execute(
                "SELECT l.chat_id FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE lower(u.email) = lower(%s)",
                (email,),
            )
            row = cur.fetchone()
            if row:
                return str(row[0]), "account ALERT_EMAIL"
        cur.execute("SELECT chat_id FROM telegram_links ORDER BY linked_at ASC LIMIT 1")
        row = cur.fetchone()
        if row:
            return str(row[0]), "prima chat collegata"
    finally:
        conn.close()
    return None, "nessuna chat collegata"


def main():
    text = sys.argv[1] if len(sys.argv) > 1 else "CartaViva: avviso di prova"
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TELEGRAM_BOT_TOKEN mancante: nessun avviso inviato.")
        return
    try:
        chat, how = pick_chat_id()
        if not chat:
            print(f"Nessuna chat a cui scrivere ({how}): nessun avviso inviato.")
            return
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text[:3500], "disable_web_page_preview": True},
            timeout=15,
        )
        print(f"Telegram ({how}): HTTP {r.status_code} {'ok' if r.ok else r.text[:200]}")
    except Exception as e:  # mai nascondere l'errore del controllo
        print(f"Avviso Telegram non inviato: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
