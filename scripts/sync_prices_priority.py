"""
Scheduler di sync prezzi a batch prioritari (docs/binder_reserved_work_plan_2026-09-11.md,
punto 3), pensato per girare spesso (ogni 5-15 minuti, vedi
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

"allarmi attivi" (la fascia con priorita' piu' alta nel piano originale) non
e' ancora implementabile: la tabella degli allarmi Telegram per-carta e'
lavoro futuro (punto 4). Quando esistera' andra' aggiunta SOPRA la fascia 1
qui sotto, non in sostituzione delle fasce attuali.

A differenza di scripts/sync_prices.py, questo script NON manda notifiche
Telegram: farlo ad ogni batch (ogni 5-15 minuti anziche' 2 volte al giorno)
amplificherebbe di molto il problema gia' noto di scripts/notify_telegram.py
(nessuno stato di soglia-gia'-superata salvato tra un run e l'altro - lo
stesso avviso puo' ripetersi ad ogni sync, vedi punto 4 del piano) - da
"si ripete due volte al giorno" a "si ripete fino a un centinaio di volte al
giorno" per qualunque carta il cui prezzo resti sotto quello del giorno
prima. Le notifiche restano quindi su un cron separato e indipendente
(.github/workflows/notify_telegram.yml, stessa cadenza 2x/giorno di prima),
finche' il punto 4 non risolve il problema di fondo con uno stato per-utente.

Uso:
  python scripts/sync_prices_priority.py
"""
import sys
from datetime import datetime, timezone

from api_client import CardTraderClient
import db

BUDGET_SECONDS = 240  # ~4 minuti di richieste per run, vedi il piano
# Margine ampio sopra quante carte un budget di 4 minuti a 1 richiesta/secondo
# puo' mai processare davvero (~240): solo per non caricare in memoria un
# numero di righe arbitrariamente grande se il budget venisse alzato in futuro.
FETCH_LIMIT = 1000

# Stessa soglia di scripts/sync_prices.py: se troppe carte di fila falliscono
# (qualunque sia il motivo), fermarsi invece di continuare a perdere tempo -
# qui il danno di un giro sprecato e' comunque limitato al budget di 4 minuti,
# non a ore, ma il segnale resta lo stesso.
MAX_CONSECUTIVE_ERRORS = 15


def main():
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

    print(f"Batch prioritario: {len(batch)} carte candidate, budget {BUDGET_SECONDS}s.")

    ok, errors, consecutive_errors = 0, 0, 0
    tier_counts: dict[int, int] = {}
    circuit_breaker_triggered = False
    processed = 0

    for bp_id, name, expansion_name, priority in batch:
        if datetime.now(timezone.utc).timestamp() >= deadline:
            print(f"  Budget di {BUDGET_SECONDS}s esaurito dopo {processed} carte, mi fermo qui.")
            break
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
                f"{processed}/{len(batch)} carte candidate tentate.",
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

    # La compressione dello storico (price_snapshots/binder_value_snapshots)
    # e' un'operazione da una volta al giorno, non da ripetere ad ogni batch
    # (96 run/giorno a cadenza 15 minuti): controllato con una chiave in meta
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
          f"(desideri={tier_counts.get(db.PRIORITY_WISHLIST, 0)}, "
          f"binder={tier_counts.get(db.PRIORITY_BINDER, 0)}, "
          f"catalogo={tier_counts.get(db.PRIORITY_CATALOG, 0)}).")

    if circuit_breaker_triggered:
        print(
            "Interrotto dal circuit breaker prima di finire il batch: il progresso "
            "fatto e' comunque salvo, ma il job termina con errore per restare visibile.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
