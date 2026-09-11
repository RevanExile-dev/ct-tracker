# Binder, prezzi e allarmi — richiesta del 11 settembre 2026

Base dell'audit: `24ceaff61038bcf7e10b70b745c8aa157a476e9b`.
Riallineamento verificato su main `32b435c25907be004e4b5239ec59982f100f3279`.
Branch: `chatgpt/task-20260911-binder-insights`.
[Draft PR #52](https://github.com/RevanExile-dev/ct-tracker/pull/52).

## Stato e confini del lavoro

Questa è una nuova richiesta, successiva al piano UX storico del 30 agosto,
che dichiara di non essere aggiornato retroattivamente. La issue #1 è
anch'essa datata: parla ancora di SQLite e binder solo locale; il codice
attuale, AGENTS.md e CLAUDE.md confermano Postgres e sincronizzazione account.

`docs/multi_ai_coordination.md` riserva a Claude schema dati, logica prezzi,
sync CardTrader e redesign architetturali. Le modifiche qui sono UI isolate,
correzioni riproducibili e audit di sola lettura. Le parti riservate sotto
sono specificate ma **non implementate né attivate**. Nessuna modifica a
main, branch Claude, PR #6, schema, auth, database o invii Telegram.

PR controllate: #45 è ancora Draft e riguarda prezzi/fallback (BinderTable,
CardTile, db.server, types); #50 e #51 sullo scanner sono state mergiate
durante il lavoro. Nessuno dei loro file è modificato da questa PR.
#10 resta il progetto Cosmos separato. Nessun duplicato di questo intervento.

| Richiesta | Risultato in questa PR | Passo successivo |
|---|---|---|
| 1. Acquisto/provenienza e rendimento | Modello e criteri sotto; grafico potenziato sui dati esistenti | Claude: inventario per lotti, costi, valutazione coerente |
| 2. Ordinamento in euro | Pulsanti “Variazione € / %” e spiegazione esplicita | Nessuna modifica alla query |
| 3. Sfoglio più reale | Corretto il salto della curvatura con pulsanti/tastiera; input tastiera circoscritto al libro | QA desktop/touch; eventuale modello di pagina continuo |
| 4. Sync prioritario | Audit e piano con priorità, budget e checkpoint | Claude: implementazione e misurazione della latenza |
| 5. Allarmi Telegram | Verificata implementazione esistente e specificato flusso per carta | Claude: persistenza, UI, outbox, collegamento chat |
| 6. Affidabilità dati | Script audit pubblico, campione API e confronto effettivo CardTrader | Completare profili e timestamp; correggere rischi sotto |
| 7. Consumi Vercel | Verificato delivery diretto immagini; nessuna migrazione necessaria per quelle URL | Accedere alle metriche dell'account per confermare il contatore |

## Modifiche effettive

- Grafico: 1g/7g/mese/trimestre/semestre/anno/tutto; date personalizzate,
  panoramica con estremi dello zoom, punto di confronto fissabile, delta in
  euro e percentuale, espansione, CSV dei soli punti selezionati in centesimi.
- Solo rilevazioni reali. Periodi brevi o vuoti restano navigabili, valori
  invalidi non generano tracciati NaN, valute diverse non vengono confrontate.
- Gli errori dello storico sono distinti da “nessun dato” e hanno Riprova.
  Il risultato appartiene alla richiesta/account corrente, evitando di
  ripresentare una risposta precedente durante un nuovo caricamento.
- Testo del binder chiarisce il limite corrente: una copia per tipo e
  prezzo di riferimento, anche con lingua/condizione diversa dalle proprie.
- `settleTo()` anima il progress lungo la stessa curva usata dal drag.
  Prima la transizione CSS interpolava due estremi con bend=0: con i
  pulsanti la pagina rimaneva sempre rigida. Guard contro doppio incremento
  rAF/timeout; reduced motion immediato; copie animate `inert`.
- Le frecce dentro grafico/campi di input non sfogliano più il libro.
- Nessuna nuova dipendenza di produzione. Immagini sempre dirette da
  CardTrader, `unoptimized: true`; corretto il commento sul traffico.

## Audit: problemi da risolvere prima di chiamarlo “rendimento”

1. **Quantità ignorate.** `snapshot_binder_values()` in `scripts/db.py`
   somma `best_price_cents` una volta per blueprint. Anche summary del binder
   e copertina fanno lo stesso: 3 copie da 10 euro risultano 10, non 30.
2. **Profilo fisico ignorato nella stima.** `BinderEntry` contiene lingua,
   condizione e finitura, ma la valutazione usa il “best” globale. Non è una
   valutazione individuale della copia posseduta.
3. **Totale e rendimento sono diversi.** Le snapshot registrano il totale
   delle carte presenti quel giorno. Un'aggiunta aumenta il totale anche a
   prezzi immobili; non esistono flussi o storico dei lotti per separarla.
4. **Offerta non significa valore di vendita.** Il “best” privilegia NM+Zero
   e può essere una singola inserzione anomala. Caso 122678 verificato sotto.
   Non nascondere/correggere arbitrariamente il prezzo: separare offerta
   osservata da stima, con numerosità, profilo e attendibilità visibili.
5. **Niente andamento intragiornaliero reale.** Le snapshot hanno chiave
   giornaliera e i sync della stessa data sovrascrivono il punto. Oltre la
   retention giornaliera rimane un punto/settimana. Non fabbricare ore o anni.
6. **Freschezza non dimostrabile per carta dall'API.** `last_price_sync` è
   globale e viene impostato anche dopo progresso parziale; `CardRow` non
   espone il timestamp di quella carta. Non usarlo come “tutto aggiornato”.
7. **Disponibilità/proprietà.** `_summarize_products()` verifica presenza
   del prezzo, ma non esclude esplicitamente quantità zero, venditori in
   vacanza, graded o bundle. Sono rischi della logica, non casi dichiarati
   presenti nel campione. Servono contratti/test con risposte reali.
8. **Categorie distinte.** Il catalogo contiene anche 234316 con nome
   “Hisuian Decidueye VSTAR” e versione “Hisuian Samurott VSTAR086/067”.
   La ricerca trova legittimamente il secondo testo: verificare la fonte
   del metadato prima di correggere automaticamente nomi o scanner.

### Verifica pratica CardTrader

Osservazioni browser del 11/09/2026, prezzi EUR; profilo letto anche dalle
etichette lingua/condizione delle righe, non dedotto dal nome della carta.
Nessun acquisto o aggiunta al carrello.

| Carta / ID | Dato API CartaViva | Offerta osservata su CardTrader | Esito |
|---|---|---|---|
| Professor Elm 213/214 / 122678 | minimo 75,64; IT NM Zero 10.001,64 | Blastoise_ita IT NM 75,64, senza Zero; JeffPesos–GTCorciano IT NM Zero 10.001,64 | Prezzi coincidono; “best” non è una stima realistica del ricavo |
| Shuckle 136/132 / 351655 | minimo 0,95; IT NM Zero 1,98 | Ciccio 16 IT NM 0,95 senza Zero; FeedateShop IT NM Zero 1,98; 1-Day Ready separato 3,10 | Coincidenza sui profili controllati; 1-Day Ready non va confuso con minimo Zero |

Sul primo caso il sito espone anche offerte/valori successivi diversi dal
campione salvato, ad esempio Gray Gauntlet Games MP 180,65 contro 220,55
registrati. Non certificare l'intera tabella come aggiornata per il fatto
che coincidono i due minimi verificati. Le osservazioni non sono una
certificazione dell'intero catalogo o della disponibilità al checkout.

Fonti verificate:
- [Professor Elm](https://www.cardtrader.com/it/cards/122678-professor-elm-s-lecture-ultra-rare-213-214-lost-thunder)
- [Shuckle](https://www.cardtrader.com/it/cards/351655-shuckle-illustration-rare-136-132-mega-evolution)

Campione ripetibile: `scripts/audit_public_prices.py`, risultato in
`docs/evidence/public_prices_2026-09-11.json`. Controlla 5 carte via API
pubbliche, coerenza tra valori e offerte visibili, ordinamento dello storico;
non sostituisce il confronto browser. `/listings` limita il risultato, quindi
assenza di un profilo nelle righe restituite non prova assenza sul mercato.

## Implementazione proposta a Claude: acquisti e pacchetti

Unità minima: **lotto di copie omogenee**, non solo blueprint. Due copie
della stessa carta acquistate a prezzi/date diversi, o in lingue diverse,
devono restare distinguibili. Campi: lot_id, user_id, blueprint_id, quantità,
lingua, condizione, finitura, provenienza (acquisto/pacchetto/regalo/scambio/
non specificata), data acquisizione, costo totale in centesimi e valuta.
Costo sconosciuto = null; zero è valido solo se dichiarato. Una modifica
parziale dello scanner non deve cancellare i dati di acquisto.

Per pacchetti: valore delle carte trovate separato. Opzionale gruppo di
apertura con costo effettivo dei pacchetti e quote allocate ai lotti;
somma quote mai maggiore del costo del gruppo. Il gruppo non va addebitato
di nuovo nel totale. Costo non attribuito non significa guadagno puro.

Mostrare tre indicatori distinti:
- Valore stimato della collezione, con quantità valorizzate e copertura.
- Costo e plus/minusvalenza non realizzata delle **sole copie acquistate**
  con costo noto e quotazione comparabile. Percentuale sul costo delle
  stesse copie incluse nel numeratore; escluse/ignote dichiarate.
- Valore delle carte trovate e spesa in pacchetti, senza attribuire un
  profitto automatico. Ricavo realizzato solo se una vendita è registrata.

Per grafico separare valore totale, apporti/rimozioni e variazione di
mercato. A parità di prezzi un acquisto deve far salire il valore ma
lasciare a zero l'effetto mercato. Una rimozione non deve riscrivere il
passato. Per misurare questo servono eventi dei lotti e snapshot coerenti;
non ricostruire il rendimento storico usando il binder di oggi.

Accettazione minima: 2 copie a 10 euro e mercato 12 = costo 20, valore 24,
delta +4; acquisto + pacchetto separati; costo null distinto da zero;
profilo/cambio valuta non confrontabile escluso con copertura; aggiunta
senza movimento prezzi non crea rendimento; modifica quantità e rimozione
conservano lo storico; roundtrip locale/account e migrazione reversibile.

## Proposta visiva: un raccoglitore ad anelli

Lo sfoglio corretto qui risolve un difetto preciso; non dimostra ancora
che il binder sembri un oggetto fisico. La direzione proposta per il
prototipo di Claude è un raccoglitore ad anelli con copertina rigida e
fogli trasparenti a nove tasche. Carta, tasca e foglio devono restare
allineati durante la rotazione; dorso, fori e anelli rendono leggibile il
punto di aggancio. Riflessi e ombre seguono la superficie del foglio.

Per eliminare la piega visibile fra i due pannelli attuali, prototipare una
superficie continua suddivisa in segmenti con tangenti raccordate, vincolata
al bordo degli anelli. Il trascinamento controlla un solo progress condiviso
da curvatura, fronte/retro, ombra e riflesso; pulsanti e tastiera percorrono
la stessa traiettoria. Prima confrontare il prototipo con lo sfoglio attuale
su un telefono reale, poi scegliere il renderer in base a fluidità e costo.
Le dipendenze 3D già presenti non sono da sole un motivo per introdurre WebGL.

Criteri: nessun salto a inizio/fine; retro corretto e carte leggibili a
pagina ferma; nessuna carta fantasma cliccabile; rilascio/cancellazione e
gesti rapidi avanzano esattamente il numero previsto di pagine; scroll
verticale utilizzabile; reduced motion con passaggio immediato; navigazione
sempre possibile anche tramite pulsanti. Misurare frame persi su desktop e
touch durante uno sfoglio completo: la sola presenza di una curva non è QA
del realismo né della fluidità.

Per il grafico economico successivo: serie selezionabili di valore totale,
valore delle copie acquistate e relativo costo; eventi di acquisto/rimozione
selezionabili sulla linea temporale; dettaglio del punto con quantità,
copertura dei prezzi e data di osservazione. Carte da pacchetti in una vista
separata. Le nuove serie richiedono il modello dati sopra: non ricostruirle
artificialmente dalle snapshot aggregate attuali.

## Implementazione proposta: sync e notifiche

Ordine: allarmi attivi → desideri → binder → catalogo generale. Deduplicare
gli ID tra utenti e liste; proprietà personalizzate restano private.
Le liste solo locali di ospiti non sono visibili ai job: UI deve richiedere
account per notifiche persistenti, non promettere che il browser chiuso lavori.

Obiettivo iniziale: allarmi 15 minuti, desideri 30, binder 60; sono target
da misurare, non garanzie. Niente aumento indiscriminato del rate limit.
L'API documenta sia 1 sia 10 richieste/s nello stesso paragrafo: mantenere
il limite prudente attuale di 1/s finché verificato. Espansione e lingua
sono filtri documentati; confrontare empiricamente una richiesta per
espansione con quelle per blueprint prima di adottare batching.
[Documentazione CardTrader](https://www.cardtrader.com/en/docs/api/full/reference).

I due daily attuali (06/18 UTC, second run forzato) e full domenicale
occupano `ct-tracker-db-write`, condiviso anche con catalogo/indice scanner.
Un full di 29.315 richieste a 1/s richiede almeno 8,14 ore; il timeout 720
minuti non supera il tetto GitHub-hosted di 6 ore. Un altro cron nello
stesso gruppo rimarrebbe bloccato; inoltre la coda default sostituisce il
run pending precedente quando ne arriva un altro.
[Limiti Actions](https://docs.github.com/en/actions/reference/limits),
[concorrenza](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Soluzione proposta: unico scheduler di prezzi a piccoli batch con scadenza
e checkpoint persistenti, budget di circa 4 minuti di richieste per run,
priorità riesaminate a ogni batch. Catalogo completo distribuito nel tempo,
non un unico job di otto ore. Il progresso risiede in Postgres, non nella
coda volatile Actions. Non usare concurrency group separati per aggirare il
limite API condiviso. Misurare durata p95, ritardo coda, età p95/p99 dei
prezzi prioritari e copertura del catalogo; mostrare `observed_at` per carta.
Cron Actions può ritardare: gli avvisi non vanno presentati come realtime
garantito. [Schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Telegram attuale: config/watchlist.json è vuoto; `alert_below` esiste ma è
globale/file-based, il calo percentuale è globale e usa `min_price_cents`,
non il profilo IT NM Zero. Non c'è stato di attraversamento soglia e può
ripetere lo stesso avviso a ogni sync. Non basta aggiungere un bottone.

Flusso per carta: scegli profilo esatto e target in euro **oppure** ribasso
percentuale; mostra prezzo/data base e target risultante prima di salvare.
Il riferimento percentuale resta fissato alla creazione, non si sposta a
ogni sync. Target 20 euro con −15% = 17 euro. Nessun fallback di lingua,
condizione o valuta. Opzione “avvisami una volta” predefinita; riarmo esplicito
o isteresi/cooldown dichiarati. Collegamento Telegram verificato per account,
senza memorizzare token nel browser o in git.

Valutare solo quote fresche e disponibili del profilo scelto. Inserire un
evento deduplicato in outbox con l'aggiornamento prezzi; segnare inviato dopo
conferma Telegram, gestire retry/backoff e messaggi lunghi. La consegna su
rete può essere ambigua dopo un timeout: non promettere exactly-once.
Test con trasporto finto, poi un unico allarme reale autorizzato al proprietario;
nessun invio indiscriminato agli utenti.

## Vercel: cosa è verificato e cosa manca

`web/public` pesa circa 2,5 MB; le carte usano URL CardTrader esterni,
`next/image` è già unoptimized. Non sono 30 GB di immagini archiviate nel
repository corrente. Il browser le scarica dal fornitore direttamente,
senza passare da `/_next/image`. Questa è già l'alternativa senza costo
aggiuntivo; nessun nuovo storage/CDN necessario per queste immagini.

Il collegamento Vercel restituisce `teams: []`: impossibile leggere il
consumo effettivo o confermare 30/10 GB. Distinguere Deployment Storage,
Image Transformations, Blob e Data Transfer. La migrazione Postgres ha
rimosso i database dai nuovi deploy, ma non prova che gli artefatti dei
vecchi deploy siano stati eliminati. Non cancellati deploy o cambiata
retention alla cieca. `web/vercel.json` disabilita già le preview dei branch
diversi da main. Per completare: identificare contatore/periodo/progetto,
verificare retention e vecchi deploy con DB, conservare rollback utile e
misurare prima/dopo. [Image Optimization](https://vercel.com/docs/image-optimization/limits-and-pricing).

## Verifiche

- [x] Lint e build Next.js con TypeScript riusciti prima della pubblicazione.
- [x] 30 test unitari dopo il riallineamento a main, inclusi 5 nuovi sullo storico/CSV.
- [x] Test browser raccolti correttamente da Playwright; inclusi nel workflow UI esistente.
- [x] Audit codice e confronto CardTrader live dei due casi sopra.
- [ ] QA locale browser: `ERR_BLOCKED_BY_CLIENT` verso localhost; Chromium
  locale assente e download in timeout. Nessun bypass dei limiti ambiente.
- [ ] Esecuzione delle nuove interazioni in CI: controllare il run della PR,
  distinguendo test con API simulate da verifica del database/account reale.
  Il [primo run](https://github.com/RevanExile-dev/ct-tracker/actions/runs/34586353027)
  ha passato 16/17 prove (5/6 nuove): corretta l'ambiguità del selettore
  dell'alert, che intercettava anche l'announcer di Next.js. Rerun richiesto.
- [ ] Review finale Gemini/Groq tramite `ai_review.yml` provider `auto`.
  Tool di dispatch non esposto nella sessione: usare workflow esistente,
  non creare un secondo sistema di review.
- [ ] Merge e verifica produzione a cura di Claude, come da regole.
