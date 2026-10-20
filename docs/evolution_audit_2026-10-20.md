# Audit e consegna dei miglioramenti — 20 ottobre 2026

Riferimento: richiesta dell'utente di analizzare il progetto e preparare modifiche in thread separati, senza merge. Base esaminata: `main` a `dd7ac242232ea8591a96ec2ba74e4c7c0a3db094`. Questo è un resoconto dell'audit e delle prove, non un nuovo piano UX né un sostituto di `docs/UX_REDESIGN_PLAN.md` o del coordinamento su PR #6.

Sono stati esaminati i percorsi della scheda carta, catalogo/API, import, collezioni/allarmi e la configurazione CI; gli script di sync sono stati letti per segnalare rischi a Claude. Non è una certificazione completa di sicurezza, accessibilità o prestazioni di ogni pagina.

## Modifiche preparate

Tutte le PR sono Draft indipendenti dalla stessa base. Nessun merge o deploy effettuato da ChatGPT.

| PR e branch | Problema e intervento | Verifiche registrate |
| --- | --- | --- |
| [#236](https://github.com/RevanExile-dev/ct-tracker/pull/236) — `chatgpt/task-import-date-validation` | Date impossibili nell'import e CSV con record finale troncato. Validazione gregoriana condivisa, avviso/omissione della data invalida e scarto del solo record incompleto. | `npm ci`, lint, build; 184 unitari passati. Sei casi falliscono sui moduli originali. Contratto della patch di import verificato con persistenza simulata. |
| [#237](https://github.com/RevanExile-dev/ct-tracker/pull/237) — `chatgpt/task-catalog-query-validation` | ID e pagine malformati arrivavano a SQL producendo HTTP 500. Validazione conservando filtro assente, filtro vuoto e input validi. | `npm ci`, lint, build; 178 unitari passati. 29 confronti HTTP prima/dopo: casi invalidi 500→200, corpi dei casi validi invariati. |
| [#238](https://github.com/RevanExile-dev/ct-tracker/pull/238) — `chatgpt/task-collections-concurrency` | Rollback di un'intera lista dopo una richiesta fallita poteva cancellare operazioni concorrenti riuscite. Ripristino per riga e blocco delle scritture sovrapposte sullo stesso allarme. | `npm ci`, lint, build; 172 unitari e 21 test browser passati, di cui 9 nuovi. Due casi falliscono sull'interfaccia originale. |
| [#235](https://github.com/RevanExile-dev/ct-tracker/pull/235) — `chatgpt/task-scheda-veloce` | Riutilizzo dei dati server e avvio parallelo di storico/inserzioni senza attenderli per inviare la scheda; test adattati al nuovo percorso. | `npm ci`, lint, build; 172 unitari e 35 test browser locali passati. **Vincolo prestazionale non superato:** vedere sotto e lo stato aggiornato della PR. |

Gli esiti locali riportati sono quelli delle sessioni di implementazione; non sono tutti stati rieseguiti il 20 ottobre. Il lint aveva due warning preesistenti, nessun errore. I confronti HTTP locali della PR #237 e le prove SQL locali della scheda usavano PGlite 0.5.10, PostgreSQL in WebAssembly tramite socket: non PostgreSQL nativo. I test browser locali usavano Chromium 153; quelli delle collezioni avevano API simulate con risposte differite ed eventi touch reali, quindi non provano la persistenza autenticata.

## CI controllata il 20 ottobre

| PR/head | Build e unitari | UI su PostgreSQL nativo |
| --- | --- | --- |
| #236 `cdc1aff` | [successo](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093762101) | [259/259 passati](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093764415) |
| #237 `fc1f6fb` | [successo](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093788957) | [259/259 passati](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093790817) |
| #238 `9fdeb3d` | [successo](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093883843) | [268/268 passati](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093885405) |
| #235 `ee83915` | [successo](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093818591) | [262 passati, 1 fallito](https://github.com/RevanExile-dev/ct-tracker/actions/runs/39093821137): conteggio fisso 87 nel test filtri, seed diventato 90 con le tre nuove carte di prova. |

Il commit `8cd0298` sulla stessa PR #235 corregge il conteggio: legge il totale corrente dall'API e verifica che il risultato filtrato sia positivo e minore. `npm ci`, lint, 172 unitari e build sono passati anche il 20 ottobre; nuova CI da consultare sulla PR. I link sopra documentano gli esiti di quegli SHA; la PR contiene l'esito dell'eventuale commit successivo. La CI verifica le suite selezionate dal workflow, non ogni possibile stato o ogni test del repository.

## Scheda carta: decisione prestazionale

Il confronto locale raccolto è parziale: alcuni campioni migliorano il grafico, ma altri mostrano piccoli peggioramenti di prezzo o immagine. Il precedente processo e i suoi file temporanei non sono più disponibili. Non viene dichiarato completo il benchmark a tre carte/tre giri, né vengono ricostruiti risultati mancanti.

**Non proporre #235 per il merge sulla base di queste misure.** La regola richiesta è che nessun caso peggiori; non è dimostrata. I test funzionali e una CI verde non sostituiscono questo criterio. Occorre un confronto riproducibile prima/dopo con il metodo concordato, inclusi utente di ritorno e storico lungo, e la verifica di Claude in produzione prevista dal task. Il sito in produzione non è stato modificato da questo lavoro.

Il prefetch delle altre pagine è nei componenti condivisi, incluso SiteHeader: non è stato cambiato. Nessuna modifica a cache, service worker, PWA, host delle immagini, policy di sicurezza o schema DB.

## Prossimi interventi proposti, ancora da implementare

I rilievi seguenti sono confermati per lettura del codice della base indicata. Dove manca una riproduzione eseguibile, è esplicitato. Non sono già corretti dalle PR sopra.

| Priorità | Evidenza e possibile impatto | Intervento e criterio di accettazione |
| --- | --- | --- |
| Alta | `web/lib/lotImport.server.ts`, `matchRow`: un'espansione `null` diventa `""`; `setLower.includes("")` è vero. Un candidato senza espansione può quindi superare il filtro di un set dichiarato e, se resta unico, essere accettato automaticamente. Deduzione dal codice, non riprodotta sull'import autenticato. | Escludere l'espansione sconosciuta dalla corrispondenza positiva a un set esplicito. Testare candidato unico/multiplo, `null`/vuoto, set compatibile/incompatibile e scelta manuale; conservare il comportamento senza set dichiarato. |
| Alta | `web/components/LotImportPanel.tsx`, `ResolveRow.runSearch`: ogni risposta aggiorna risultati/loading senza identificatore della richiesta. Il bottone disabilitato non impedisce una seconda ricerca tramite Invio. Una risposta vecchia, anche fallita, può prevalere sulla nuova. Deduzione dal codice, non riprodotta nel browser. | Identificare la ricerca attiva e ignorare risposte superate. Test browser con A lenta/B veloce, fallimento tardivo di A, Invio ripetuto e smontaggio; mantenere selezione e conferma corrette. |
| Media | `web/lib/db.ts`, `fetchCards`: anche `ids: []` produce una richiesta, pur significando risultato vuoto. `idsProvided` preserva già correttamente la semantica server. | Valutare ritorno immediato solo per array esplicitamente vuoto. Testare zero richieste nel caso vuoto e comportamento invariato per filtro assente/non vuoto; misurare prima/dopo sui chiamanti. |
| Media | `.github/workflows/ci_frontend.yml`: unitari/build su push, nessuno step lint. Node 20 qui e 22 nella UI. `ui_smoke.yml` installa Playwright senza versione fissata e fuori lockfile. | Proposta per Claude: aggiungere lint e rendere riproducibili Node/Playwright nel workflow esistente. Verificare trigger e test prima di cambiare configurazione; non creare un workflow parallelo. Nessun file `.github/` modificato. |
| Da misurare | `web/app/binder/page.tsx` importa staticamente `BinderBook`, che importa `@gullabs/react-flipbook`, anche quando la vista è griglia. Il costo effettivo del bundle non è stato misurato. | Valutare separazione del caricamento solo dopo misure. Confrontare griglia e accesso diretto al libro, nuovo/ritorno, touch e deep link; scartare se peggiora uno dei percorsi. |
| Da misurare | Prefetch delle pagine condivise segnalato nella cascata della scheda. Nessun benchmark isolato attribuisce qui il costo a ciascuna richiesta. | Thread separato per SiteHeader/componenti condivisi, con confronto anche della navigazione successiva. Non trasferire semplicemente il costo dalla scheda alla pagina seguente. |

## Rilievi riservati a Claude: sync e infrastruttura

- **`scripts/sync_prices_priority.py`:** il ciclo incrementa `processed` e registra `last_attempted_at` per tutto il gruppo prima delle chiamate API. Il circuit breaker può interrompere il ciclo interno al primo errore che raggiunge la soglia: la coda del gruppo può risultare tentata senza essere stata richiesta. Il commento che garantisce tutti i tentativi non copre quel `break`. Rischio dedotto dal controllo di flusso, non incidente di produzione osservato. Prima di modificare: test deterministico con soglia raggiunta a metà gruppo, verifica dei contatori, dei timestamp e della selezione nel run successivo; salvaguardare la protezione contro la starvation.
- **`scripts/neon_suspend.py`:** `others_busy()` legge l'attività, poi la connessione viene chiusa e viene inviata la richiesta HTTP di sospensione. Nuove richieste possono arrivare tra controllo e sospensione. È una finestra temporale visibile nel codice, non un disservizio riprodotto; non prova come Neon gestisca ogni connessione in quel momento. Valutare con Claude misure e protezioni senza modifiche speculative alla produzione.

Non sono stati cambiati script di sync, prezzi, schema, migrazioni, permessi o segreti. I due rilievi richiedono il processo di review già presente, non un nuovo sistema di coordinamento.

## Handoff e limiti

Ordine suggerito per la review: #236 (integrità import), #237 (input API), #238 (concorrenza UI). Sono indipendenti; Claude può scegliere un ordine diverso. #235 resta separata e non approvata sul criterio prestazionale. Prima di ogni integrazione controllare la base corrente e rieseguire i controlli necessari sul risultato combinato: il verde di branch isolate non prova automaticamente la loro combinazione.

Restano non verificati telefono fisico, Safari, rete mobile reale, utente con vecchio stato/cache/service worker, dati e carico di produzione. Non è stata eseguita in questo lavoro la review finale Gemini/Groq tramite `ai_review.yml`: resta al coordinatore usare il workflow esistente e valutare criticamente i rilievi. Il merge rimane esclusivamente a Claude secondo il task e il protocollo del repository.
