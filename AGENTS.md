# Istruzioni per Codex su questo repository

Questo file è quello che OpenAI Codex (e agenti simili) legge automaticamente
come istruzioni permanenti per il repo — l'equivalente di `CLAUDE.md`, che
resta la fonte principale di contesto sul progetto (leggilo per intero prima
di lavorare: struttura, workflow multi-AI, e soprattutto la sezione
"Disciplina di verifica" più sotto in questo stesso file, che si applica
anche a te).

## Il tuo ruolo qui

Claude Code è il coordinatore del lavoro su questo repository: analizza le
richieste dell'utente, mantiene il contesto tra sessioni, decide le priorità
e fa la verifica finale prima che qualcosa venga considerato completo. Tu
(Codex) sei un implementatore capace su task ben definiti — non un secondo
coordinatore indipendente. In pratica:

- Se l'utente ti assegna un task direttamente, implementalo, ma **non
  dichiarare mai completata una voce di checklist che non hai potuto
  verificare per davvero**. Se il tuo sandbox non può raggiungere
  `localhost` o aprire un browser reale (limite noto, già riscontrato:
  `ERR_BLOCKED_BY_CLIENT`), scrivilo esplicitamente nel piano/commit invece
  di segnare `[x]`. Claude Code ha un ambiente con dev server e Playwright
  funzionanti e fa la verifica browser reale come passo successivo — è il
  motivo per cui esiste questa divisione di ruoli, non un dettaglio da
  aggirare.
- Non riscrivere o duplicare la logica di coordinamento/review multi-AI già
  esistente (`scripts/ai_review.py`, `.github/workflows/ai_review.yml`,
  documentata in `CLAUDE.md` sotto "Ruoli e coordinamento"). Se ti serve un
  secondo parere, usa quel workflow com'è.
- Piani di lavoro persistenti (es. `docs/UX_REDESIGN_PLAN.md`) sono
  documenti condivisi: aggiornali onestamente (checklist reale, non
  aspirazionale) invece di crearne uno parallelo per lo stesso lavoro.

## Prima di ogni push

- Verifica sempre che nessun workflow di sync prezzi sia in corso
  (`sync_prices.yml`) prima di pushare — un push durante un sync in corso ha
  già causato un fallimento reale in questo repo. Se non hai un modo diretto
  di controllarlo dal tuo ambiente, dillo esplicitamente nel commit/nota
  invece di pushare alla cieca.
- `npm run lint` e `npm run build` (dentro `web/`) devono passare prima di
  ogni push — non solo type-check isolato.

## Disciplina di verifica (vale anche per te)

Regole nate da errori reali fatti in questo repository (non teoria
astratta) — le stesse che segue Claude Code, riportate qui perché valgono
per chiunque tocchi questo codice:

1. **Un bug segnalato è un campione, non il problema intero.** Se correggi
   un'istanza di un pattern (es. un componente che non usa il prezzo
   "best", un filtro che sovrasta il contenuto), cerca lo stesso pattern
   altrove nel codice PRIMA di dichiarare finito, non aspettare che
   l'utente lo richieda di nuovo.
2. **Controlla tutti gli stati di una UI**: caricamento, errore, vuoto,
   dati normali — non solo lo stato con dati reali.
3. **"Implementato" non è "verificato".** Una checklist con `[x]` su voci
   di QA visivo/interattivo che non hai potuto eseguire per davvero è
   un'informazione falsa che spreca il tempo di chi legge il piano dopo di
   te. Lascia `[ ]` con una nota sul perché, sempre.
4. **Non pushare mai su `main` senza controllare sync in corso.**
5. **Prima di dire "fatto", ricontrolla esplicitamente** se lo stesso
   pattern appena corretto esiste altrove nel codice o in un altro stato
   della stessa UI.

## Contesto tecnico rapido

- `web/`: Next.js 16 / React 19, deploy su Vercel (Root Directory = `web`).
  Legge due database SQLite (`cardtrader.db`, `price_history.db`) nel
  browser via sql.js/WASM — nessun backend dedicato, niente API route per i
  dati.
- `scripts/`: sync Python (catalogo, prezzi, notifiche) che gira su GitHub
  Actions, non tocca `web/` direttamente ma scrive i `.db` che `web/`
  legge da `web/public/data/`.
- `web/tests/mobile-toolbar.spec.mjs` (Playwright, gira in CI via
  `.github/workflows/ui_smoke.yml`) copre la toolbar filtri responsive — non
  è ancora una suite ampia, ma non è più vero che "non esiste nulla di
  automatizzato". Per il resto la verifica è build + lint + type-check +
  controllo manuale/Playwright in browser, come prima.
- Se stai leggendo questo file come "ChatGPT" tramite il canale di dispatch
  PR #6 (`coord/chatgpt-dispatch`, commenti `[CHATGPT]`/`[CHATGPT-REVISION]`)
  invece che come Codex CLI: la meccanica completa del canale e quando
  Claude delega vs tiene per sé è in `docs/multi_ai_coordination.md` — le
  regole di questo file (non riscrivere `ai_review.py`, disciplina di
  verifica, controllo sync prima del push) restano valide comunque.
