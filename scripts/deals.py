"""
"Affari veri": avviso Telegram quando una carta della lista desideri
compare a un prezzo molto sotto il suo prezzo abituale (2026-10-13).

A differenza degli allarmi prezzo (price_alerts), l'utente non imposta
nulla carta per carta: basta avere la carta nei desideri e Telegram
collegato. Il confronto e' sempre sullo STESSO profilo esatto, italiano +
Near Mint + CardTrader Zero (latest_prices.it_nm_zero_price_cents, il prezzo
di default del sito): mai un'offerta simile spacciata per uguale, e mai la
media Cardmarket, che mescola lingue e condizioni.

"Prezzo abituale" = mediana dei minimi giornalieri dello stesso profilo
negli ultimi 30 giorni, oggi escluso (price_snapshots). La mediana e non la
media: un singolo giorno anomalo (un'offerta civetta o un picco) non sposta
il riferimento.

Soglie scelte su dati reali (Neon, 2026-10-13, 75 carte nei desideri,
ultimi 30 giorni): con -25% e almeno 2 euro di risparmio sarebbero stati
26 avvisi su 13 carte, circa 6 a settimana. Con -20% erano 231 giorni-carta
in "affare" su 33 carte: troppi per essere un segnale.

Chiamata da sync_prices_priority.py subito dopo gli allarmi, nella stessa
transazione per-carta: nessuna chiamata API in piu', legge i prezzi appena
scritti. Come per gli allarmi, il messaggio va in telegram_outbox e lo
manda drain_telegram_outbox (alert_id NULL: niente bottoni sotto).
"""
from __future__ import annotations

import html
from datetime import datetime, timedelta, timezone

import db

# Sconto minimo sul prezzo abituale perche' sia un affare (0.25 = -25%).
MIN_DISCOUNT = 0.25
# Risparmio minimo in centesimi: sotto i 2 euro un -25% su una carta da
# pochi euro e' rumore, non un affare da notificare.
MIN_SAVING_CENTS = 200
# Giorni di storico per il prezzo abituale, e quanti giorni con un prezzo
# servono almeno per fidarsi della mediana (carta appena uscita o rara).
HISTORY_DAYS = 30
MIN_HISTORY_DAYS = 5
# Stessa carta, stesso utente: un nuovo avviso solo dopo questi giorni, o
# prima se il prezzo scende ancora di almeno il 10% rispetto all'ultimo
# avviso (un prezzo che oscilla attorno alla soglia non deve mandare un
# messaggio a ogni giro: nei dati reali la stessa carta entrava e usciva
# dalla soglia fino a 4 volte in un mese).
RENOTIFY_DAYS = 7
FURTHER_DROP = 0.90


def is_deal(current_cents: int | None, usual_cents: float | None, history_days: int) -> bool:
    """True se il prezzo attuale e' un affare rispetto al prezzo abituale."""
    if current_cents is None or usual_cents is None or current_cents <= 0 or usual_cents <= 0:
        return False
    if history_days < MIN_HISTORY_DAYS:
        return False
    return (current_cents <= usual_cents * (1 - MIN_DISCOUNT)
            and usual_cents - current_cents >= MIN_SAVING_CENTS)


def should_notify(current_cents: int, last_price_cents: int | None,
                  last_notified_at: datetime | None, now: datetime) -> bool:
    """Evita di ripetere l'avviso per la stessa carta allo stesso utente."""
    if last_notified_at is None or last_price_cents is None:
        return True
    if now - last_notified_at >= timedelta(days=RENOTIFY_DAYS):
        return True
    return current_cents <= last_price_cents * FURTHER_DROP


def format_deal_message(card_name: str, expansion_name: str, current_cents: int,
                        usual_cents: float, currency: str | None, blueprint_id: int) -> str:
    """HTML come gli allarmi (vedi db._format_alert_message): nomi da
    CardTrader con html.escape(), il resto e' testo fisso."""
    symbol = {"EUR": "€", "USD": "$", "GBP": "£"}.get(currency, currency or "")
    discount = round((1 - current_cents / usual_cents) * 100)
    safe_card = html.escape(card_name[:db.MAX_ALERT_NAME_LENGTH])
    safe_expansion = html.escape(expansion_name[:db.MAX_ALERT_NAME_LENGTH])
    text = (
        f"🔥 <b>Affare sulla tua lista desideri</b>\n"
        f"<b>{safe_card}</b> ({safe_expansion})\n"
        f"Italiano, Near Mint, CardTrader Zero: <b>{current_cents / 100:.2f}{symbol}</b>\n"
        f"Di solito: {usual_cents / 100:.2f}{symbol} (−{discount}%, mediana degli ultimi {HISTORY_DAYS} giorni)\n"
        f"{db.CARDTRADER_CARD_URL.format(blueprint_id)}"
    )
    return text[:db.MAX_TELEGRAM_CAPTION_LENGTH]


def evaluate_deals_for_blueprint(conn, blueprint_id: int, card_name: str, expansion_name: str,
                                 now: datetime | None = None) -> int:
    """Accoda un avviso "affare" per ogni utente che ha la carta nei
    desideri, Telegram collegato e gli affari attivi. Ritorna quanti
    avvisi ha accodato. Nessuna query sullo storico se nessuno e'
    interessato alla carta (il caso di gran lunga piu' comune)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT w.user_id, t.chat_id, d.price_cents, d.notified_at
               FROM wishlist_cards w
               JOIN telegram_links t ON t.user_id = w.user_id AND t.deal_alerts = 1
               LEFT JOIN deal_notices d ON d.user_id = w.user_id AND d.blueprint_id = w.blueprint_id
               WHERE w.blueprint_id = %s""",
            (blueprint_id,),
        )
        watchers = cur.fetchall()
        if not watchers:
            return 0

        cur.execute(
            "SELECT it_nm_zero_price_cents, it_nm_zero_price_currency FROM latest_prices WHERE blueprint_id = %s",
            (blueprint_id,),
        )
        row = cur.fetchone()
        if not row or row[0] is None:
            return 0
        current_cents, currency = row

        cur.execute(
            """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p), COUNT(*)
               FROM (SELECT captured_at, MIN(it_nm_zero_price_cents) AS p
                     FROM price_snapshots
                     WHERE blueprint_id = %s
                       AND it_nm_zero_price_cents IS NOT NULL
                       AND captured_at < CURRENT_DATE
                       AND captured_at >= CURRENT_DATE - %s
                     GROUP BY captured_at) AS daily""",
            (blueprint_id, HISTORY_DAYS),
        )
        usual_cents, history_days = cur.fetchone()
        if not is_deal(current_cents, usual_cents, history_days or 0):
            return 0

        cur.execute("SELECT image_url FROM blueprints WHERE id = %s", (blueprint_id,))
        image_row = cur.fetchone()
        image_url = image_row[0] if image_row else None

        now = now or datetime.now(timezone.utc)
        text = format_deal_message(card_name, expansion_name, current_cents, usual_cents, currency, blueprint_id)
        queued = 0
        for user_id, chat_id, last_price, last_at in watchers:
            if not should_notify(current_cents, last_price, last_at, now):
                continue
            cur.execute(
                """INSERT INTO deal_notices (user_id, blueprint_id, price_cents, usual_price_cents, notified_at)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (user_id, blueprint_id) DO UPDATE
                   SET price_cents = EXCLUDED.price_cents,
                       usual_price_cents = EXCLUDED.usual_price_cents,
                       notified_at = EXCLUDED.notified_at""",
                (user_id, blueprint_id, current_cents, round(usual_cents), now),
            )
            # Dedup come per gli allarmi, con il prezzo nella chiave: un
            # giro ripetuto non duplica il messaggio, ma un secondo calo
            # dello stesso giorno (vedi should_notify) arriva comunque.
            cur.execute(
                """INSERT INTO telegram_outbox (alert_id, chat_id, dedup_key, payload, image_url)
                   VALUES (NULL, %s, %s, %s, %s)
                   ON CONFLICT (dedup_key) DO NOTHING""",
                (chat_id, f"deal:{user_id}:{blueprint_id}:{now.date().isoformat()}:{current_cents}", text, image_url),
            )
            queued += cur.rowcount
        return queued
