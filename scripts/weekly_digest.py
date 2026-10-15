"""Riepilogo settimanale su Telegram (opt-in, spento di default).

Chi ha Telegram collegato e ha acceso `telegram_links.weekly_digest` riceve
la domenica (dalle 10:00 di Roma) un solo messaggio con: valore del binder e
variazione degli ultimi 7 giorni, carte con un allarme prezzo scattato nella
settimana, maggiori rialzi/ribassi tra le sue carte.

Non apre un workflow suo e non consuma minuti di GitHub Actions in piu':
`queue_weekly_digests` viene chiamata dal giro prezzi che gira gia' (vedi
scripts/sync_prices_priority.py) e accoda i messaggi in `telegram_outbox`,
che lo stesso giro svuota (drain_telegram_outbox). Costo sul database:
- fuori dalla finestra (tutti i giorni tranne la domenica dalle 10:00):
  zero query;
- in finestra: una query per sapere chi manca (indice parziale su
  weekly_digest) e 3 query leggere per utente, a blocchi di
  DIGEST_BATCH_USERS per giro; gli altri utenti vengono presi dai giri
  successivi (ogni 30 minuti). Una volta preparato, l'utente non viene
  piu' toccato fino alla settimana dopo (last_digest_week).

Il testo e' HTML (come gli avvisi degli allarmi): nomi di carte ed espansioni
vengono da CardTrader e passano da html.escape.
"""
import html
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROME = ZoneInfo("Europe/Rome")
DIGEST_WEEKDAY = 6  # domenica
DIGEST_FROM_HOUR = 10  # ora di Roma
DIGEST_BATCH_USERS = 50
TOP_N = 3
MIN_MOVE_PCT = 5.0
MIN_MOVE_CENTS = 50
MAX_NAME = 40
MAX_ALERT_LINES = 5
MAX_MESSAGE_LENGTH = 4000  # sendMessage accetta 4096 caratteri
SITE_URL = "https://ct-tracker-eight.vercel.app"

DIGEST_OFF_CALLBACK = "wd:off"  # allineato a web/app/api/telegram/webhook/route.ts


def digest_week_key(now: datetime) -> str | None:
    """Chiave ISO della settimana ("2026-W42") se `now` e' dentro la finestra
    di invio (domenica dalle 10:00 di Roma), altrimenti None: in quel caso
    il chiamante non fa nessuna query."""
    local = now.astimezone(ROME)
    if local.weekday() != DIGEST_WEEKDAY or local.hour < DIGEST_FROM_HOUR:
        return None
    iso = local.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def digest_reply_markup() -> dict:
    return {"inline_keyboard": [[{"text": "🔕 Spegni il riepilogo", "callback_data": DIGEST_OFF_CALLBACK}]]}


def _money(cents: int, currency: str | None) -> str:
    symbol = {"EUR": "€", "USD": "$", "GBP": "£"}.get(currency, currency or "")
    return f"{cents / 100:.2f}{symbol}"


def _name(name: str, expansion: str | None = None) -> str:
    text = f"<b>{html.escape((name or '?')[:MAX_NAME])}</b>"
    if expansion:
        text += f" ({html.escape(expansion[:MAX_NAME])})"
    return text


def _binder_value(cur, user_id, today: date):
    """(ultimo punto, punto di confronto di almeno 7 giorni prima o None)."""
    cur.execute(
        """SELECT captured_at, total_cents, currency, cards_count, priced_count
           FROM binder_value_snapshots WHERE user_id = %s
           ORDER BY captured_at DESC LIMIT 1""",
        (user_id,),
    )
    last = cur.fetchone()
    if not last or last[3] == 0:
        return None, None
    cur.execute(
        """SELECT captured_at, total_cents, currency FROM binder_value_snapshots
           WHERE user_id = %s AND captured_at <= %s
           ORDER BY captured_at DESC LIMIT 1""",
        (user_id, last[0] - timedelta(days=7)),
    )
    return last, cur.fetchone()


def _fired_alerts(cur, user_id):
    cur.execute(
        """SELECT b.name, b.expansion_name,
                  COALESCE(lp.best_price_cents, lp.min_price_cents),
                  COALESCE(lp.best_price_currency, lp.min_price_currency),
                  a.target_type, a.target_value, a.baseline_currency
           FROM price_alerts a
           JOIN blueprints b ON b.id = a.blueprint_id
           LEFT JOIN latest_prices lp ON lp.blueprint_id = a.blueprint_id
           WHERE a.user_id = %s AND a.fired_at >= now() - interval '7 days'
           ORDER BY a.fired_at DESC LIMIT %s""",
        (user_id, MAX_ALERT_LINES + 1),
    )
    return cur.fetchall()


def _binder_moves(cur, user_id, today: date):
    """Carte del binder con prezzo "in evidenza" attuale (fresco, <= 3 giorni)
    e prezzo di 7 giorni fa (ultimo punto storico tra 14 e 7 giorni fa)."""
    base = today - timedelta(days=7)
    cur.execute(
        """SELECT b.name, b.expansion_name, lp.best_price_cents, old.best_price_cents,
                  COALESCE(lp.best_price_currency, lp.min_price_currency)
           FROM binder_cards bc
           JOIN blueprints b ON b.id = bc.blueprint_id
           JOIN latest_prices lp ON lp.blueprint_id = bc.blueprint_id
           JOIN LATERAL (
               SELECT ps.best_price_cents FROM price_snapshots ps
               WHERE ps.blueprint_id = bc.blueprint_id
                 AND ps.captured_at <= %s AND ps.captured_at >= %s
                 AND ps.best_price_cents > 0
               ORDER BY ps.captured_at DESC LIMIT 1
           ) old ON true
           WHERE bc.user_id = %s AND lp.best_price_cents > 0
             AND lp.captured_at_ts >= now() - interval '3 days'""",
        (base, base - timedelta(days=7), user_id),
    )
    rows = []
    for name, exp, now_c, old_c, cur_code in cur.fetchall():
        delta = now_c - old_c
        pct = delta / old_c * 100
        if abs(pct) >= MIN_MOVE_PCT and abs(delta) >= MIN_MOVE_CENTS:
            rows.append((name, exp, old_c, now_c, pct, cur_code))
    risers = sorted((r for r in rows if r[4] > 0), key=lambda r: -r[4])[:TOP_N]
    fallers = sorted((r for r in rows if r[4] < 0), key=lambda r: r[4])[:TOP_N]
    return risers, fallers


def build_digest(cur, user_id, today: date) -> str | None:
    """Testo del riepilogo per un utente, o None se non c'e' niente da dire
    (binder vuoto, nessun allarme scattato, nessun movimento): meglio nessun
    messaggio di un messaggio vuoto."""
    lines = ["📊 <b>Il tuo riepilogo settimanale</b>", ""]
    has_content = False

    last, base = _binder_value(cur, user_id, today)
    if last:
        has_content = True
        _, total, currency, cards, priced = last
        line = f"🗂 <b>Binder</b>: {_money(total, currency)}"
        if base and (base[2] or "EUR") == (currency or "EUR") and base[1] > 0:
            delta = total - base[1]
            pct = delta / base[1] * 100
            sign = "▲" if delta > 0 else "▼" if delta < 0 else "="
            line += f" ({sign} {_money(abs(delta), currency)}, {pct:+.1f}% in 7 giorni)"
        lines.append(line)
        if priced < cards:
            lines.append(f"<i>{cards - priced} carte senza prezzo non sono contate.</i>")
        lines.append("")

    alerts = _fired_alerts(cur, user_id)
    if alerts:
        has_content = True
        lines.append("🎯 <b>Hanno toccato il tuo obiettivo</b>")
        for name, exp, price, currency, t_type, t_value, base_cur in alerts[:MAX_ALERT_LINES]:
            cur_code = currency or base_cur
            target = _money(t_value, cur_code) if t_type == "absolute_cents" else f"-{t_value}%"
            now_txt = f"ora {_money(price, cur_code)}, " if price is not None else ""
            lines.append(f"• {_name(name, exp)}: {now_txt}obiettivo {target}")
        if len(alerts) > MAX_ALERT_LINES:
            lines.append("…e altre nella pagina degli allarmi.")
        lines.append("")

    risers, fallers = _binder_moves(cur, user_id, today)
    for title, rows, arrow in (("📈 <b>Più in rialzo nelle tue carte</b>", risers, "▲"),
                               ("📉 <b>Più in ribasso nelle tue carte</b>", fallers, "▼")):
        if rows:
            has_content = True
            lines.append(title)
            for name, exp, old_c, now_c, pct, currency in rows:
                lines.append(f"• {_name(name, exp)}: {_money(old_c, currency)} → "
                             f"{_money(now_c, currency)} ({arrow} {abs(pct):.0f}%)")
            lines.append("")

    if not has_content:
        return None
    lines.append(f'<a href="{SITE_URL}/account/telegram">Gestisci il riepilogo</a>')
    return "\n".join(lines)[:MAX_MESSAGE_LENGTH]


def queue_weekly_digests(conn, now: datetime | None = None) -> tuple[int, int]:
    """Prepara (e accoda in telegram_outbox) il riepilogo per un blocco di
    utenti a cui manca ancora questa settimana. Ritorna (accodati, saltati
    perche' senza nulla da dire). Non invia niente: lo fa
    drain_telegram_outbox. Idempotente: last_digest_week e la dedup_key
    "digest:<utente>:<settimana>" impediscono un doppio accodamento anche
    con due giri in parallelo."""
    now = now or datetime.now(timezone.utc)
    week = digest_week_key(now)
    if week is None:
        return 0, 0
    today = now.astimezone(ROME).date()
    queued = skipped = 0
    with conn.cursor() as cur:
        cur.execute(
            """SELECT user_id, chat_id FROM telegram_links
               WHERE weekly_digest AND last_digest_week IS DISTINCT FROM %s
               ORDER BY user_id LIMIT %s""",
            (week, DIGEST_BATCH_USERS),
        )
        due = cur.fetchall()
        for user_id, chat_id in due:
            text = build_digest(cur, user_id, today)
            if text:
                cur.execute(
                    """INSERT INTO telegram_outbox (alert_id, chat_id, dedup_key, payload)
                       VALUES (NULL, %s, %s, %s) ON CONFLICT (dedup_key) DO NOTHING""",
                    (chat_id, f"digest:{user_id}:{week}", text),
                )
                queued += 1
            else:
                skipped += 1
            cur.execute("UPDATE telegram_links SET last_digest_week = %s WHERE user_id = %s", (week, user_id))
    conn.commit()
    return queued, skipped
