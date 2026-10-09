"""
Scheduler di sync prezzi a batch prioritari (docs/binder_reserved_work_plan_2026-09-11.md,
punto 3), pensato per girare spesso (due modalita': --tracked ogni 30 minuti e --catalog 4 volte al giorno, vedi
.github/workflows/sync_prices_priority.yml) invece dei tre cron fissi che
sostituisce (i due di scripts/sync_prices.py --only-daily alle 06:00/18:00
UTC e quello settimanale --force completo): quei cron avevano un problema
strutturale, non solo di frequenza - un sync completo su ~30.000+ carte al
rate limit di 1 richiesta/secondo di CardTrader supera le 8 ore, vicino al
tetto di 6 ore dei runner GitHub-hosted, e per tutta la sua durata blocca
qualunque altro sync nello stesso concurrency group (ct-tracker-db-write).

Questo script processa invece un BUDGET DI TEMPO fisso per run (default 4
minuti, vedi BUDGET_SECONDS), scegliendo ogni volta le carte piu' urgenti da
aggiornare invece di seguire un ordine fisso per espansione:
  1. Carte in wishlist di almeno un utente.
  2. Carte nel binder di almeno un utente.
  3. Resto del catalogo.
Dentro ogni fascia, le carte con il tentativo piu' vecchio (o mai tentate)
vengono prima - vedi fetch_priority_batch() in scripts/db.py. Non c'e' nessun
cursore/offset salvato tra un run e l'altro: la priorita' viene ricalcolata
da zero ad ogni chiamata, e la carta appena tentata scivola naturalmente in
fondo alla sua fascia perche' il suo "ultimo tentativo" e' ora il piu'
recente - stesso principio di un nastro trasportatore, non di una coda con
puntatore esplicito. Il tentativo (latest_prices.last_attempted_at) viene
registrato PRIMA della chiamata a CardTrader e A PRESCINDERE dall'esito -
non solo sul successo (captured_at_ts, aggiornato separatamente da
upsert_latest_price): una carta che fallisce SEMPRE (es. un blueprint
rimosso da CardTrader) altrimenti resterebbe per sempre in cima alla sua
fascia, e con 15+ carte cosi' il circuit breaker scatterebbe ad ogni run
prima di raggiungere qualunque altra carta - bug di starvation reale,
trovato in review su questa PR e corretto qui.

"allarmi attivi" (la fascia con priorita' piu' alta nel piano originale) e'
arrivata con la sotto-parte 4c: PRIORITY_ALERT in scripts/db.py, sopra la
fascia desideri - una carta con un allarme prezzo 'armed' (vedi tabella
price_alerts) ottiene il prezzo piu' fresco possibile ad ogni run.

Subito dopo aver riscritto price_listings per una carta (db.replace_price_listings
sotto), questo script valuta anche i suoi allarmi prezzo 'armed'
(db.evaluate_price_alerts_for_blueprint) - nessuna chiamata API in piu',
legge solo i prezzi appena scritti. Uno scatto accoda un messaggio in
telegram_outbox invece di mandarlo subito: drain_telegram_outbox() qui
sotto svuota la coda a fine run, con retry/backoff (MAI "inviato
esattamente una volta", vedi il piano). A differenza della vecchia
watchlist di scripts/notify_telegram.py (che non salva nessuno stato
"soglia gia' segnalata" tra un run e l'altro, e quindi si limita
deliberatamente a un cron 2x/giorno per non ripetere lo stesso avviso un
centinaio di volte), un price_alert ha uno stato per-utente vero
(state='fired' dopo lo scatto): puo' quindi essere valutato ad ogni batch
(ad ogni run) senza ripetersi, perche' semplicemente non e' piu'
'armed' finche' non viene ri-armato (fire_mode='rearm', dopo il cooldown -
db.rearm_due_price_alerts) o l'utente lo riattiva a mano. La vecchia
watchlist (config/watchlist.json) resta com'era, sul suo cron separato
(.github/workflows/notify_telegram.yml): i price_alerts sono un sistema
nuovo e distinto, non una sua sostituzione.

Uso:
  python scripts/sync_prices_priority.py
"""
import os
import sys
from collections import deque
from datetime import datetime, timezone

import requests

from api_client import CardTraderClient
import db

# ~50 minuti di richieste per run (~3000 carte a 1 richiesta/secondo), con
# cron ogni 3 ore: il vecchio budget di 4 minuti con cron a 15 minuti
# (di fatto 4-6 run al giorno, GitHub scarta i cron troppo frequenti)
# copriva solo ~1000 carte/giorno su ~30.000.
BUDGET_SECONDS = 3000  # default (nessun argomento): tutte le fasce, come prima
# Due modalita' separate (vedi .github/workflows/sync_prices_priority.yml e
# sync_prices_catalog.yml): le carte tracciate (allarmi/desideri/binder,
# ~200 oggi) vanno aggiornate spesso con un run breve; il resto del
# catalogo (~30.000) puo' essere piu' lento, con un run lungo e raro.
# Un budget corto basta alle tracciate (~200 carte a 1 req/s = ~3,5 minuti);
# il tetto serve solo a fermare il run se le tracciate crescono molto.
TRACKED_BUDGET_SECONDS = 600
CATALOG_BUDGET_SECONDS = 2700
TRACKED_PASS_INTERVAL_SECONDS = 25 * 60  # --catalog: ogni ~25 min un passaggio sulle carte tracciate
TRACKED_MIN_INTERVAL_MINUTES = 20  # allarmi/desideri gia' aggiornati da meno di cosi' non si rifanno nello stesso passaggio
BINDER_MIN_INTERVAL_MINUTES = 50  # binder: circa ogni ora (< 60 cosi' un giro in ritardo non salta un ciclo intero)
# Margine ampio sopra quante carte un budget di 50 minuti a 1 richiesta/secondo
# puo' mai processare davvero (~3000): solo per non caricare in memoria un
# numero di righe arbitrariamente grande se il budget venisse alzato in futuro.
FETCH_LIMIT = 5000

# Bug di starvation reale (trovato controllando i log del 2026-09-26 dopo che
# l'utente ha segnalato il set "30th Celebration" senza prezzi): fetch_priority_batch
# ordina PRIMA per fascia (allarmi/desideri/binder/catalogo) e SOLO ALL'INTERNO
# di ciascuna fascia per anzianita' - ma il loop qui sotto si ferma non appena
# il budget scade, quindi se le fasce 0-2 (allarmi+desideri+binder) da sole
# riempiono gia' l'intero budget (come e' successo: ogni run recente processa
# 17 allarmi + 53 desideri + 40-90 binder e si ferma li', "catalogo=0" in
# ogni singolo run), la fascia 3 (PRIORITY_CATALOG, ~30.000 carte - l'intero
# resto del catalogo, incluso qualunque set appena uscito) non viene MAI
# raggiunta: puo' restare bloccata a zero prezzi per settimane, a prescindere
# da quanto spesso giri lo scheduler. Fix: si riordina il batch gia' ordinato
# per priorita' spostando le carte di fascia 3 subito dopo le prime
# MAX_NON_CATALOG_PER_RUN carte di fascia 0-2 (invece che tutte in fondo),
# cosi' il catalogo ottiene sempre una fetta garantita di ogni run invece di
# passare avanti solo se avanza budget dopo binder - le eventuali carte
# 0-2 rimaste (binder molto numeroso) restano comunque nel batch, processate
# dopo se il budget lo consente ancora.
MAX_NON_CATALOG_PER_RUN = 300

# Stessa soglia di scripts/sync_prices.py: se troppe carte di fila falliscono
# (qualunque sia il motivo), fermarsi invece di continuare a perdere tempo -
# qui il danno di un giro sprecato e' comunque limitato al budget del run (50 minuti),
# non a ore, ma il segnale resta lo stesso.
MAX_CONSECUTIVE_ERRORS = 15


def drain_telegram_outbox(conn, token: str) -> tuple[int, int]:
    """Svuota telegram_outbox (sotto-parte 4c del piano): un fallimento di
    rete dopo che Telegram ha gia' recapitato il messaggio farebbe
    ritentare (l'utente vede lo stesso avviso due volte) - MAI un allarme
    scattato perso silenziosamente, mai "inviato esattamente una volta".
    Backoff crescente tra un tentativo e il successivo sullo stesso
    messaggio (db.fetch_pending_outbox), tetto massimo di tentativi oltre
    cui un messaggio resta per sempre non inviato invece di essere
    ritentato all'infinito - stesso principio del circuit breaker sopra,
    applicato per-messaggio invece che per l'intero batch.

    Se il messaggio ha un'immagine (telegram_outbox.image_url), prova prima
    sendPhoto (foto + didascalia); un fallimento specifico della foto
    (URL scaduta, non raggiungibile da Telegram, ecc.) ripiega su
    sendMessage con lo stesso testo nello stesso tentativo, cosi' un
    problema con l'immagine non fa mai perdere l'avviso."""
    pending = db.fetch_pending_outbox(conn)
    sent, failed = 0, 0
    for outbox_id, chat_id, payload, image_url, alert_id in pending:
        ok_response = False
        photo_error = None
        reply_markup = db.alert_reply_markup(alert_id)
        extra = {"reply_markup": reply_markup} if reply_markup else {}

        # Con immagine si prova prima sendPhoto (foto + didascalia): un
        # fallimento qui (URL scaduta, non raggiungibile da Telegram, ecc.)
        # non deve far perdere l'avviso intero - si ripiega su sendMessage
        # con lo stesso testo, mai un'eccezione che salta il fallback.
        if image_url:
            try:
                resp = requests.post(
                    f"https://api.telegram.org/bot{token}/sendPhoto",
                    json={"chat_id": chat_id, "photo": image_url, "caption": payload, "parse_mode": "HTML", **extra},
                    timeout=15,
                )
                ok_response = resp.ok and resp.json().get("ok")
                if not ok_response:
                    photo_error = f"{resp.status_code} {resp.text}"
            except Exception as exc:
                photo_error = str(exc)

        if not ok_response:
            if photo_error:
                print(f"  [ATTENZIONE] invio foto Telegram fallito per outbox id={outbox_id} "
                      f"(ripiego su solo testo): {photo_error}", file=sys.stderr)
            try:
                resp = requests.post(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    json={"chat_id": chat_id, "text": payload, "parse_mode": "HTML", **extra},
                    timeout=15,
                )
                ok_response = resp.ok and resp.json().get("ok")
                if not ok_response:
                    print(f"  [ATTENZIONE] invio Telegram fallito per outbox id={outbox_id}: "
                          f"{resp.status_code} {resp.text}", file=sys.stderr)
            except Exception as exc:
                print(f"  [ATTENZIONE] invio Telegram fallito per outbox id={outbox_id}: {exc}", file=sys.stderr)

        if ok_response:
            db.mark_outbox_sent(conn, outbox_id)
            sent += 1
        else:
            db.mark_outbox_failed(conn, outbox_id)
            failed += 1
        conn.commit()
    return sent, failed


def tracked_due(conn) -> list:
    """Carte tracciate (allarmi, desideri, binder, in quest'ordine) da
    aggiornare ora: allarmi e desideri se non tentati negli ultimi
    TRACKED_MIN_INTERVAL_MINUTES, il binder se non tentato negli ultimi
    BINDER_MIN_INTERVAL_MINUTES. Usata da --catalog per non lasciare ferme
    le carte tracciate durante il run lungo (stesso gruppo di concorrenza:
    i giri --tracked restano in coda finche' il catalogo non finisce)."""
    rows = [r for r in db.fetch_priority_batch(conn, FETCH_LIMIT) if r[3] != db.PRIORITY_CATALOG]
    binder_ids = [r[0] for r in rows if r[3] == db.PRIORITY_BINDER]
    other_ids = [r[0] for r in rows if r[3] != db.PRIORITY_BINDER]
    skip = db.fetch_recently_attempted_ids(conn, binder_ids, BINDER_MIN_INTERVAL_MINUTES)
    skip |= db.fetch_recently_attempted_ids(conn, other_ids, TRACKED_MIN_INTERVAL_MINUTES)
    return [r for r in rows if r[0] not in skip]


def main():
    global BUDGET_SECONDS
    mode = "all"
    if "--tracked" in sys.argv:
        mode = "tracked"
        BUDGET_SECONDS = TRACKED_BUDGET_SECONDS
    elif "--catalog" in sys.argv:
        mode = "catalog"
        BUDGET_SECONDS = CATALOG_BUDGET_SECONDS
    db.init_db()
    client = CardTraderClient()
    conn = db.get_connection()
    cur = conn.cursor()

    start = datetime.now(timezone.utc)
    today = start.strftime("%Y-%m-%d")
    now_iso = start.isoformat()
    deadline = start.timestamp() + BUDGET_SECONDS

    batch = db.fetch_priority_batch(conn, FETCH_LIMIT)
    if not batch:
        print("Nessuna carta nel catalogo. Lancia prima scripts/sync_catalog.py")
        sys.exit(1)

    # Vedi il commento su MAX_NON_CATALOG_PER_RUN sopra: senza questo riordino
    # la fascia 3 (resto del catalogo) puo' non essere mai raggiunta se le
    # fasce piu' urgenti da sole riempiono il budget del run.
    non_catalog = [row for row in batch if row[3] != db.PRIORITY_CATALOG]
    catalog = [row for row in batch if row[3] == db.PRIORITY_CATALOG]
    if mode == "tracked":
        # Allarmi e desideri a ogni giro (30 min); il binder circa ogni ora
        # (vedi BINDER_MIN_INTERVAL_MINUTES): giri piu' corti = il DB Neon resta sveglio meno a lungo.
        binder_ids = [r[0] for r in non_catalog if r[3] == db.PRIORITY_BINDER]
        fresh = db.fetch_recently_attempted_ids(conn, binder_ids, BINDER_MIN_INTERVAL_MINUTES)
        batch = [r for r in non_catalog if r[0] not in fresh]
        print(f"  Binder saltato perche' aggiornato da meno di {BINDER_MIN_INTERVAL_MINUTES} min: {len(fresh)} carte.")
    elif mode == "catalog":
        batch = catalog
    else:
        batch = non_catalog[:MAX_NON_CATALOG_PER_RUN] + catalog + non_catalog[MAX_NON_CATALOG_PER_RUN:]

    print(f"Batch prioritario [{mode}]: {len(batch)} carte candidate, budget {BUDGET_SECONDS}s.")

    ok, errors, consecutive_errors = 0, 0, 0
    alerts_fired = 0
    tier_counts: dict[int, int] = {}
    circuit_breaker_triggered = False
    processed = 0

    # In --catalog le carte tracciate scadute si inseriscono in testa alla coda
    # ogni TRACKED_PASS_INTERVAL_SECONDS (la prima volta subito): stessa
    # priorita' di sempre (allarmi > desideri > binder), il catalogo prosegue dopo.
    queue = deque(batch)
    next_tracked_pass = start.timestamp() if mode == "catalog" else None
    tracked_passes = 0

    while True:
        now_ts = datetime.now(timezone.utc).timestamp()
        if now_ts >= deadline:
            print(f"  Budget di {BUDGET_SECONDS}s esaurito dopo {processed} carte, mi fermo qui.")
            break
        if next_tracked_pass is not None and now_ts >= next_tracked_pass:
            due = tracked_due(conn)
            queue.extendleft(reversed(due))
            tracked_passes += 1
            next_tracked_pass = now_ts + TRACKED_PASS_INTERVAL_SECONDS
            print(f"  Passaggio tracciate #{tracked_passes}: {len(due)} carte scadute messe in testa alla coda.")
        if not queue:
            break
        bp_id, name, expansion_name, priority = queue.popleft()
        processed += 1
        tier_counts[priority] = tier_counts.get(priority, 0) + 1

        # Registrato e COMMITTATO subito, PRIMA della chiamata a CardTrader
        # che puo' fallire: altrimenti una carta che fallisce sempre (es. un
        # blueprint rimosso da CardTrader) resterebbe per sempre in cima alla
        # sua fascia di priorita' (captured_at_ts non si aggiorna mai sui
        # fallimenti), bloccando l'intero batch ad ogni run - bug di
        # starvation reale, trovato in review su questa PR (vedi
        # fetch_priority_batch in scripts/db.py).
        try:
            db.mark_attempted(conn, bp_id, now_iso)
            conn.commit()
        except Exception as exc:
            print(f"  [ERRORE] impossibile registrare il tentativo per {name} id={bp_id}: {exc}", file=sys.stderr)
            conn.rollback()
            errors += 1
            consecutive_errors += 1
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                circuit_breaker_triggered = True
                break
            continue

        try:
            products = client.get_marketplace_products(bp_id)

            db.insert_price_snapshot(conn, bp_id, today, now_iso, products)
            db.upsert_latest_price(conn, bp_id, today, now_iso, products)
            db.replace_price_listings(conn, bp_id, today, products)

            # Subito dopo aver riscritto price_listings per QUESTA carta:
            # legge i prezzi appena scritti, nessuna chiamata API in piu'.
            # Nella stessa transazione per-carta cosi' un ROLLBACK su
            # questa carta (es. l'update rarity sotto fallisse) annulla
            # anche uno scatto di allarme basato su dati che non sono mai
            # stati confermati - vedi il commento di modulo in cima al file.
            fired = db.evaluate_price_alerts_for_blueprint(conn, bp_id, name, expansion_name)
            alerts_fired += fired

            if products:
                props = products[0].get("properties_hash", {}) or {}
                rarity = props.get("pokemon_rarity") or props.get("rarity")
                if rarity:
                    cur.execute(
                        "UPDATE blueprints SET rarity = %s WHERE id = %s",
                        (rarity, bp_id),
                    )

            # Commit per carta, non a fine batch: stesso motivo di
            # sync_prices.py, un ROLLBACK su un errore non deve scartare
            # anche il lavoro delle carte riuscite prima nello stesso giro.
            conn.commit()
            ok += 1
            consecutive_errors = 0
        except Exception as exc:  # non bloccare l'intero batch per una carta problematica
            print(f"  [ERRORE] {name} ({expansion_name}) id={bp_id}: {exc}", file=sys.stderr)
            conn.rollback()
            errors += 1
            consecutive_errors += 1

        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            circuit_breaker_triggered = True
            print(
                f"  [ATTENZIONE] {consecutive_errors} carte di fila fallite: mi fermo qui "
                f"invece di continuare a perdere il budget di questo run, "
                f"{processed} carte tentate.",
                file=sys.stderr,
            )
            break

    # Snapshot del valore Binder: economico e idempotente (upsert per
    # (user_id, oggi)), va bene rilanciarlo ad ogni batch invece che una
    # sola volta al giorno - riflette cosi' i prezzi piu' freschi disponibili
    # in quel momento invece di un solo istante fisso.
    binder_users = db.snapshot_binder_values(conn, today)
    if binder_users:
        print(f"Valore Binder salvato per {binder_users} utenti.")

    # Ri-arma gli allarmi 'rearm' il cui cooldown e' scaduto: economico
    # (un solo UPDATE su tutta la tabella), va bene farlo ad ogni batch
    # invece che una volta al giorno - un allarme ripetibile deve tornare
    # 'armed' appena possibile, non aspettare la prossima compressione
    # storico.
    rearmed = db.rearm_due_price_alerts(conn)
    conn.commit()
    if rearmed:
        print(f"Ri-armati {rearmed} allarmi 'rearm' con cooldown scaduto.")

    # Svuota la coda di invio Telegram degli allarmi scattati in questo
    # batch (e in eventuali batch precedenti rimasti in coda per un
    # fallimento temporaneo) - stesso interruttore "silenziosamente
    # disattivato senza il secret" di scripts/notify_telegram.py, non un
    # errore fatale se TELEGRAM_BOT_TOKEN non e' configurato.
    telegram_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if telegram_token:
        sent, failed = drain_telegram_outbox(conn, telegram_token)
        if sent or failed:
            print(f"Coda Telegram allarmi: {sent} messaggi inviati, {failed} falliti (ritentati al prossimo giro).")
    elif alerts_fired:
        print(
            "TELEGRAM_BOT_TOKEN non configurato: gli allarmi scattati in questo batch "
            "restano in coda (telegram_outbox) finche' non verra' impostato.",
            file=sys.stderr,
        )

    # La compressione dello storico (price_snapshots/binder_value_snapshots)
    # e' un'operazione da una volta al giorno, non da ripetere ad ogni batch
    # (8 run/giorno): controllato con una chiave in meta
    # invece che con una finestra fissa sull'orario di avvio (es. "solo se
    # start.hour==3 e start.minute<15") - i cron di GitHub Actions possono
    # ritardare anche di parecchi minuti nelle ore di punta, e una finestra
    # di 15 minuti sarebbe facile da mancare per l'intera giornata (rilievo
    # di review su questa PR).
    if db.get_meta(conn, "last_pruned_date") != today:
        pruned = db.prune_old_history(conn)
        if pruned:
            print(f"Storico compresso: rimossi {pruned} punti giornalieri "
                  f"oltre i {db.RETENTION_DAILY_DAYS} giorni (tenuto 1 punto/settimana).")
        binder_pruned = db.prune_old_binder_value_history(conn)
        if binder_pruned:
            print(f"Storico valore Binder compresso: rimossi {binder_pruned} punti "
                  f"oltre i {db.RETENTION_DAILY_DAYS} giorni (tenuto 1 punto/settimana).")
        db.set_meta(conn, "last_pruned_date", today)

    finished = datetime.now(timezone.utc)
    db.record_sync_checkpoint(
        conn, now_iso, finished.isoformat(), BUDGET_SECONDS,
        tier_counts, ok, errors, circuit_breaker_triggered,
    )
    db.set_meta(conn, "last_price_sync", finished.isoformat())
    conn.commit()
    cur.close()
    conn.close()

    print(f"\nCompletato in {(finished - start).total_seconds():.0f}s: "
          f"{ok} carte aggiornate, {errors} errori "
          f"(allarmi={tier_counts.get(db.PRIORITY_ALERT, 0)}, "
          f"desideri={tier_counts.get(db.PRIORITY_WISHLIST, 0)}, "
          f"binder={tier_counts.get(db.PRIORITY_BINDER, 0)}, "
          f"catalogo={tier_counts.get(db.PRIORITY_CATALOG, 0)}); "
          f"{alerts_fired} allarmi prezzo scattati.")

    if circuit_breaker_triggered:
        print(
            "Interrotto dal circuit breaker prima di finire il batch: il progresso "
            "fatto e' comunque salvo, ma il job termina con errore per restare visibile.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
