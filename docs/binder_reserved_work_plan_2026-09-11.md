# Binder: piano delle parti riservate (post-review PR #52)

Data: 2026-09-11. Segue la review di [PR #52](https://github.com/RevanExile-dev/ct-tracker/pull/52)
(`chatgpt/task-20260911-binder-insights`, implementata da ChatGPT come
implementatore delegato, vedi `docs/multi_ai_coordination.md`) e del suo
report [`docs/binder_insights_2026-09-11.md`](https://github.com/RevanExile-dev/ct-tracker/blob/chatgpt/task-20260911-binder-insights/docs/binder_insights_2026-09-11.md).

Questo documento è la decisione e il piano di Claude per le parti che
`docs/multi_ai_coordination.md` riserva esplicitamente a Claude (schema
dati, logica prezzi, sync CardTrader, Telegram) — non implementate qui,
non delegabili a ChatGPT. Ogni punto del report è stato riverificato a
mano sul codice reale prima di essere accettato (vedi riferimenti a
file/riga sotto), non preso per buono.

## Esito review PR #52

- CI verde: 30 unit test, 17/17 UI test.
- Diff letto per intero (grafico storico, sfoglio, testo "Movimento carte",
  script di audit read-only): implementazione solida, stati caricamento/
  errore/vuoto/valuta-mista gestiti esplicitamente, nessuna regressione
  trovata nella mia lettura.
- Review Gemini/Groq (`ai_review.yml`, provider `auto`, run
  [34590805079](https://github.com/RevanExile-dev/ct-tracker/actions/runs/34590805079)):
  1 bug reale — in `BinderBook.tsx`, `animate()` può rischedularsi
  all'infinito se il componente si smonta mentre uno sfoglio è in corso
  (`settlingRef` non viene resettato allo smontaggio). Richiesta la
  correzione a ChatGPT via `[CHATGPT-REVISION]` su PR #6. Un secondo
  rilievo (slittamento di data per fuso orario in
  `normalizeCollectionHistory`) verificato e **non riproducibile** con i
  dati reali: `getBinderValueHistory` (`web/lib/account.server.ts:100-109`)
  restituisce `captured_at::text` da una colonna Postgres `DATE`, sempre
  `"YYYY-MM-DD"` puro, mai un timestamp con offset — richiesto comunque
  come miglioramento difensivo facoltativo, non bloccante.
- Merge di #52 in sospeso fino al push del fix (1) da parte di ChatGPT;
  nessun altro blocco.

## Principio guida per tutto il piano sotto

**Il valore stimato del binder non è un profitto.** Un ricavo è
"realizzato" solo quando una vendita viene registrata esplicitamente
dall'utente; finché non lo è, ogni cifra derivata (valore stimato,
plus/minusvalenza) va etichettata come tale in UI, mai presentata come
guadagno. Vale per il grafico attuale (già rispettato: la nota sotto il
delta dice esplicitamente "Non misura il guadagno sugli acquisti") e per
tutto quanto pianificato sotto.

## 1. Correzione quantità/profilo della valutazione

**Verificato**, non solo dedotto dal report:
- `snapshot_binder_values()` (`scripts/db.py:416-450`) fa
  `SUM(lp.best_price_cents)` una volta per riga di `binder_cards`, ignorando
  `bc.data->>'quantity'`.
- Stesso bug lato client, stessa euristica per design (vedi commento su
  `binder_value_snapshots` in `web/db/schema.sql:233-243`):
  `web/app/binder/page.tsx:79-81` somma `best_price_cents` per carta senza
  moltiplicare per quantità.
- `BinderEntry` (`web/lib/binder.ts:25-32`) ha già `quantity`, `language`,
  `condition`, `finish`: il dato esiste lato client, va solo propagato e
  usato — non serve un nuovo campo, solo nuova logica di lettura.

Piano (prerequisito concettuale del punto 2, va prima):
1. Server: in `snapshot_binder_values`, moltiplicare `best_price_cents` per
   `COALESCE((bc.data->>'quantity')::int, 1)`. Stessa correzione nel
   percorso che oggi calcola "Valore stimato" per la UI (verificare se
   passa da `web/lib/db.server.ts` o è calcolato client-side su `CardRow`
   come oggi in `page.tsx`) — deve restare lo stesso numero in entrambi i
   posti, come impone il commento sullo schema.
2. Sostituire il "best" globale (NM + CardTrader Zero a cascata) con un
   lookup sul profilo posseduto quando `language`/`condition` sono noti:
   query su `price_listings` filtrata, non solo lettura di
   `latest_prices.best_price_cents`. Profilo esatto assente → fallback
   esplicito al "best" globale, ma segnalato in UI (badge/tooltip), mai
   silenzioso — stesso principio "mai un prezzo di un profilo diverso
   spacciato per lo stesso" già seguito da `it_nm_zero_price_cents`.
3. Copertura visibile: "N/M carte valutate sul profilo esatto" accanto al
   totale.

Criterio di accettazione: 3 copie della stessa carta a 10€ risultano 30€,
non 10€; una carta con profilo IT/Played dichiarato non usa più
silenziosamente il prezzo NM/Zero.

## 2. Lotti con costo/provenienza

Unità minima: lotto di copie omogenee (non il blueprint intero) — due
copie della stessa carta comprate a prezzi/date diverse devono restare
distinguibili.

- Nuova tabella `binder_lots`: `lot_id`, `user_id`, `blueprint_id`,
  `quantity`, `language`, `condition`, `finish`, `provenance` (acquisto /
  pacchetto / regalo / scambio / non specificata), `acquired_at`,
  `cost_total_cents` (NULL = sconosciuto, 0 valido solo se dichiarato),
  `cost_currency`. Tabella indipendente da `binder_cards` (che resta
  l'aggregato usato dalla UI attuale) — nessun trigger che cancelli i
  lotti per una modifica dello scanner o del binder.
- Pacchetti: tabella opzionale `pack_openings` (`pack_id`, `user_id`,
  `cost_total_cents`, `acquired_at`), `binder_lots.pack_id` nullable.
  Vincolo applicativo (non DB): somma delle quote allocate ai lotti di un
  pacchetto ≤ costo del pacchetto. Il pacchetto non va addebitato di nuovo
  nel totale.
- Tre indicatori separati in UI, mai un unico "valore":
  1. Valore stimato collezione (quantità × prezzo di profilo, punto 1) su
     tutte le copie, comprate o no.
  2. Costo e plus/minusvalenza **non realizzata** solo sulle copie con
     `cost_total_cents` noto — percentuale calcolata sul costo di quelle
     stesse copie, mai su tutta la collezione.
  3. Pacchetti: valore carte trovate vs spesa, "nessun profitto
     automatico" esplicito in UI — un ricavo esiste solo se l'utente
     registra una vendita (funzionalità futura, fuori scope qui).
- Grafico: separare valore totale, apporti/rimozioni di lotti e variazione
  di mercato — serve una tabella eventi (`binder_lot_events`: `lot_id`,
  `event_type` add/remove/quantity_change, `delta`, `occurred_at`) per non
  dover ricostruire a ritroso dal binder di oggi (vietato dal report,
  correttamente: "non ricostruire il rendimento storico usando il binder
  di oggi").
- Migrazione: ogni riga esistente di `binder_cards` diventa opzionalmente
  un lotto "provenienza non specificata, costo NULL" — solo insert,
  reversibile, script one-shot sul modello di `migrate_to_postgres.py`.

Criterio di accettazione (dal report, confermato): 2 copie a 10€ e mercato
12€ → costo 20, valore 24, delta +4; acquisto e pacchetto separati; costo
`NULL` distinto da zero; aggiunta senza movimento prezzi non crea
rendimento; modifica quantità/rimozione conservano lo storico.

## 3. Sync prioritario

**Verificato**: `sync_prices.yml` (due cron 06:00/18:00 UTC, timeout 300
min) e `sync_prices_full.yml` (cron domenicale, timeout 720 min)
condividono il concurrency group `ct-tracker-db-write` con
`sync_catalog.yml` e `build_scanner_index.yml` — un full da ~29.315
richieste a 1 richiesta/secondo richiede >8 ore, vicino al tetto di 6 ore
per i runner GitHub-hosted, e blocca qualunque altro sync nello stesso
gruppo per tutta la durata.

Piano: unico scheduler a piccoli batch che sostituisce i tre cron fissi.
- Ordine priorità per batch: allarmi attivi → desideri → binder →
  catalogo generale (dedup ID tra utenti/liste; liste solo-locali di
  ospiti non entrano, serve un account per notifiche persistenti).
- Budget ~4 minuti di richieste per run, rate limit prudente 1
  richiesta/secondo finché non verificato altrimenti (la documentazione
  CardTrader cita sia 1 che 10 req/s nello stesso paragrafo — non basta a
  giustificare un aumento senza una verifica empirica separata).
- Checkpoint persistito in Postgres (nuova tabella `sync_checkpoint`, non
  riuso di `meta` per non mischiare chiavi eterogenee), non nella coda
  volatile di Actions — priorità ricalcolata a ogni batch.
- Cron ogni N minuti (indicativamente 5-15, da misurare), stesso
  concurrency group `ct-tracker-db-write` — niente gruppi separati per
  aggirare il rate limit condiviso.
- Nuova colonna per-carta `observed_at` (oggi non esiste: `last_synced_at`
  su `blueprints` è per-carta ma non aggiornato per progresso parziale nei
  batch prioritari; `last_price_sync`-stile globale non basta, il report
  lo segnala correttamente).
- Metriche (anche solo log strutturato all'inizio): durata p95/batch,
  ritardo coda, età p95/p99 dei prezzi prioritari, copertura % catalogo.
- UI: mai presentare gli avvisi come realtime — cron Actions può
  ritardare.

Indipendente dai punti 1/2/4: può partire in parallelo.

## 4. Allarmi Telegram

**Verificato**: `config/watchlist.json` è vuoto; `scripts/notify_telegram.py`
usa `alert_below` globale/file-based su `min_price_cents` (non il profilo
IT/NM/Zero), nessuno stato di attraversamento soglia — lo stesso avviso
può ripetersi a ogni sync (`notify_telegram.py:84-136` conferma l'assenza
di stato salvato tra un run e l'altro).

Piano:
- Tabella `price_alerts`: `id`, `user_id`, `blueprint_id`, `profile`
  (language/condition/can_sell_via_hub — NULL esplicito solo se l'utente
  lo sceglie, mai un fallback silenzioso), `target_type`
  (`absolute_cents` | `percent_drop`), `target_value`,
  `baseline_price_cents` + `baseline_captured_at` (fissati alla
  creazione, mai ricalcolati ad ogni sync — target 20€ con −15% resta
  17€), `fire_mode` (once | rearm con cooldown esplicito), `state`
  (armed | fired | disabled), `created_at`.
- Valutazione solo su quotazioni fresche e disponibili del profilo esatto
  scelto — join mirata su `price_listings`/`latest_prices`, mai un
  fallback silenzioso di lingua/condizione/valuta.
- Tabella `telegram_outbox`: `alert_id`, `dedup_key`, `payload`, `sent_at`
  (NULL finché non confermato da Telegram), `retry_count` — mai "exactly
  once" promesso, backoff sui retry, troncamento messaggi lunghi.
- Collegamento account↔chat Telegram per-utente (non più solo il chat ID
  globale attuale): flusso di verifica esplicito (es. comando `/start`
  con codice), token persistito lato server, mai in `localStorage` o in
  git — stesso principio già seguito per l'auth esistente.
- Test: trasporto finto (mock) prima di tutto, poi un solo invio reale
  autorizzato al proprietario dell'account — nessun invio broadcast di
  prova a utenti reali.

Indipendente dai punti 1/2/3.

## Ordine di implementazione

1 è prerequisito concettuale di 2 (i lotti hanno bisogno di una
valutazione per-copia corretta come base, altrimenti il "valore stimato"
del punto 2.1 eredita lo stesso bug). 3 e 4 sono indipendenti tra loro e
dagli altri due, possono procedere in parallelo. Ogni punto diventa una
branch/PR separata di Claude (`claude/*`), mai delegata a ChatGPT (schema
dati, logica prezzi, sync e Telegram restano esplicitamente fuori dal suo
perimetro, vedi `docs/multi_ai_coordination.md`).
