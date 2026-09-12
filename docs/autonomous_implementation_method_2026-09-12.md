# Metodo di lavoro: implementazione autonoma multi-parte

Ricavato osservando cosa ha effettivamente funzionato nella sessione del
2026-09-12 (le quattro parti riservate del piano: 1 valutazione binder,
2 lotti, 3 sync prioritario, 4 allarmi Telegram — PR #53-#61). Non
sostituisce la "Disciplina di verifica" qui sotto, la applica dentro un
ciclo ripetibile.

**Vale per qualunque task multi-parte in questo repo**, non solo per
lavori dello stesso tipo delle quattro parti di riferimento — e include
l'autorizzazione a mergiare in autonomia su `main` quando il ciclo sotto
è stato seguito per intero (CI verde sull'ultimo commit, nessun rilievo
della review AI ancora pendente), senza chiedere conferma ad ogni singola
sotto-parte.

## Quando si applica

Un task che l'utente scompone (o chiede di scomporre) in sotto-parti
sequenziali, con l'istruzione esplicita di procedere in autonomia,
verificare a fondo ognuna con infrastruttura reale (non solo lettura del
codice) e mergiare solo quando funziona davvero.

## Il ciclo per ogni sotto-parte

1. **Checklist esplicita** (task tracker) — una voce per sotto-parte, mai
   solo un elenco mentale. Aggiornata *subito* a ogni cambio di stato, non
   in blocco alla fine.
2. **Un worktree + branch dedicato per sotto-parte.** Mai due sotto-parti
   sullo stesso branch, anche se piccole.
3. **Leggere il codice vero prima di progettare.** Mai fidarsi di un
   piano/doc/riassunto a priori — un piano può chiedere qualcosa che il
   codice già fa in un altro modo (successo nel punto 3 del piano di
   riferimento: la colonna `observed_at` richiesta dal piano era già
   `latest_prices.captured_at_ts`).
4. **Implementare seguendo le convenzioni già presenti** (stile, pattern
   di validazione, error handling) — mai introdurre un pattern nuovo dove
   uno already esiste per lo stesso problema.
5. **Verifica locale prima di qualunque commit**: typecheck, lint, build.
   Mai saltata, anche per un cambio "piccolo".
6. **Verifica su infrastruttura reale**, non solo lettura del codice o
   test unitari isolati:
   - Postgres reale (locale), dati seminati a mano, le funzioni vere
     chiamate ed eseguite — mai solo "il codice sembra corretto".
   - server buildato reale (`build && start`, non `dev`) + `curl` per le
     API.
   - browser reale (Playwright) per la UI, **con eventi touch veri su
     mobile** (`hasTouch`/`isMobile` + `.tap()`, mai un resize + `.click()`
     sintetico — vedi la Disciplina di verifica sotto, è costato un bug
     reale in passato).
   - script Python: mock solo del livello di rete esterno (CardTrader,
     Telegram), mai della logica sotto test.
7. **Ripulire subito** dati di test e script scratch dopo ogni verifica —
   non lasciarli per "dopo".
8. **Commit descrittivo**: perché, non solo cosa. Push.
9. **Draft PR con corpo dettagliato**: cosa cambia, come verificato
   (elencare i controlli fatti, non solo "testato"), eventuali limiti o
   note operative (es. variabili d'ambiente nuove da impostare).
10. **Iscriversi agli eventi della PR.**
11. **Lanciare la review AI**, provider secondo la strategia già
    descritta sopra in questo file (controllo di routine → Groq,
    controllo finale prima del merge → `auto`/Gemini).
12. **Aspettare CI + review senza polling attivo**: schedulare un
    check-in futuro invece di interrogare ripetutamente lo stato — ogni
    controllo a vuoto è un giro di conversazione buttato.
13. **Ogni rilievo della review va verificato criticamente prima di
    agire**, mai applicato o scartato a sensazione:
    - un rilievo che segnala un bug → riprodurlo con l'infrastruttura
      reale prima di considerarlo confermato.
    - un rilievo che sembra sbagliato → dimostrarlo (query diretta,
      chiamata diretta alla funzione, test mirato) prima di rigettarlo.
      Esempio reale (task 4c): un "bug critico" su `numeric * interval`
      in Postgres si è rivelato falso con una sola query da terminale.
14. **Applicare solo i fix confermati**, ri-verificare da zero (non
    fidarsi che "il fix è ovviamente giusto"), nuovo commit, nuovo push.
15. **Un fallimento CI scollegato dal diff** (nessun file in comune, un
    pattern di flake già visto altrove — es. lo stesso errore infra Postgres
    di sfondo) va confermato con quell'evidenza prima di trattarlo come
    flake: un solo re-run, mai ripetuto alla cieca.
16. **Prima di mergiare su `main`**: controllare che nessun workflow con
    permessi di scrittura sul repo sia `in_progress` (vedi la Disciplina
    di verifica sotto per l'elenco di quali workflow sono realmente
    bloccanti — non va riscritto qui).
17. **Merge (squash) solo quando**: CI verde sull'ultimo commit *e*
    nessun rilievo della review ancora pendente. A questo punto il merge
    è autonomo, senza chiedere conferma.
18. **Dopo il merge**: unsubscribe dalla PR, rimuovere il worktree,
    segnare la sotto-parte completata nella checklist.
19. Sotto-parte successiva, stesso ciclo.

## Principi trasversali

- **Mai fidarsi ciecamente** — né di memoria/documentazione pregressa, né
  di un rilievo AI: tutto va verificato contro il comportamento reale,
  in entrambe le direzioni (accettare un bug vero, rigettare un falso
  positivo).
- **Mai attesa attiva.** Un check-in schedulato costa un turno quando
  scatta; un polling a intervalli brevi ne costa molti per niente.
- **Ripulire sempre** dopo la verifica — dati di test, file scratch,
  worktree — prima di considerare la sotto-parte chiusa.
- **Fix minimo e mirato** al problema segnalato, mai un'occasione per
  allargare la PR con altro.

## È un metodo token-efficient?

Non è il più economico possibile — verificare su Postgres reale, un
browser vero con eventi touch, e lanciare la review AI ha un costo reale
per ogni sotto-parte, spesso con un secondo giro (fix + ri-verifica) dopo
la review.

Ma non è nemmeno sprecone, per due motivi specifici:
1. **Niente polling attivo** — i check-in schedulati (invece di
   ricontrollare lo stato ogni pochi minuti) sono la differenza più
   grande: senza, l'attesa di CI/review su più sotto-parti costerebbe
   molti più turni.
2. **Verificare prima costa meno che sbagliare dopo** — un bug reale
   trovato e riprodotto subito (es. il bug di starvation nel punto 3, o
   l'escaping Markdown nel punto 4c) costa una verifica mirata; lo stesso
   bug scoperto in produzione, o un fix applicato alla cieca su un falso
   positivo, costerebbe un giro di debug molto più lungo in una sessione
   futura — con meno contesto a disposizione.

Il costo reale è nel numero di sotto-parti e nei giri di review, non
nella profondità della verifica su ciascuna. Se l'obiettivo fosse
minimizzare i token piuttosto che la qualità del primo merge, i punti da
tagliare per primi sarebbero: la doppia dispatch di review (routine +
finale) per modifiche piccole, e i test Playwright reali per un cambio
di sola UI minima — non la verifica su Postgres reale, che è quasi
sempre economica e cattura la classe di bug più costosa da scoprire dopo.
