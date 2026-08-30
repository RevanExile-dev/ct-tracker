# ct-tracker

Per lo stato attuale del progetto e i prossimi passi (branch in corso, sync in
lavorazione, cosa manca), vedi la issue GitHub #1: "Stato progetto e prossimi
passi (nota di ripresa)". Consultala quando è rilevante per il compito
richiesto (es. "continua il lavoro", "a che punto siamo"), non per ogni
richiesta.

## Ruoli e coordinamento

Claude Code è il coordinatore principale del lavoro: analizza la richiesta,
definisce e implementa il piano, integra i risultati e mantiene la
responsabilità della decisione finale. Codex opera come reviewer indipendente,
non come secondo implementatore concorrente.

- Per modifiche significative, rischiose o trasversali, Claude deve richiedere
  una review indipendente con `codex exec --sandbox read-only`.
- La richiesta a Codex deve essere circoscritta e concreta: indicare il task da
  verificare, i vincoli rilevanti e le aree su cui concentrare la review.
  Quando aiuta a valutare l'implementazione, passare anche il `git diff` o
  chiedere esplicitamente a Codex di esaminarlo.
- Durante una review Codex deve restare in modalità read-only e non deve
  modificare file, creare fix o assumere il controllo dell'implementazione.
- I suggerimenti di Codex sono input di review, non decisioni automatiche:
  Claude deve verificarli criticamente nel contesto del repository, accettando
  e applicando solo quelli corretti e pertinenti.
- Claude e Codex non devono mai effettuare modifiche concorrenti sugli stessi
  file. Se Codex viene usato per un'attività diversa dalla review, assegnargli
  file o ambiti chiaramente separati e coordinare l'integrazione.
- Prima di concludere un lavoro importante, Claude deve eseguire una review
  finale con Codex sul diff complessivo e risolvere o motivare gli eventuali
  rilievi sostanziali.

Nota: `codex exec` richiede un login locale (account ChatGPT) o una API key,
quindi è invocabile solo da una sessione Claude Code che gira sul PC locale
dove Codex è autenticato, non da una sessione cloud/remota come questa. Finché
non viene collegato un self-hosted runner (o una API key dedicata), da qui la
review Codex va chiesta esplicitamente dall'utente in una sessione locale,
non eseguita in autonomia.

## Struttura del progetto

CartaViva è un tracker di carte Pokémon TCG basato sui dati di CardTrader.

- `scripts/`: script Python per sincronizzare catalogo e prezzi e inviare le
  notifiche Telegram facoltative.
- `config/`: configurazione delle espansioni tracciate e della watchlist.
- `data/`: database SQLite separati per catalogo/ultimo prezzo
  (`cardtrader.db`) e storico dei prezzi (`price_history.db`).
- `web/`: applicazione Next.js distribuita su Vercel; legge i database nel
  browser tramite sql.js/WASM, senza un backend dedicato.
- `.github/workflows/`: automazioni GitHub Actions per i sync giornalieri e
  settimanali e le altre operazioni pianificate.
