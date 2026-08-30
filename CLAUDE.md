# ct-tracker

Per lo stato attuale del progetto e i prossimi passi (branch in corso, sync in
lavorazione, cosa manca), vedi la issue GitHub #1: "Stato progetto e prossimi
passi (nota di ripresa)". Consultala quando è rilevante per il compito
richiesto (es. "continua il lavoro", "a che punto siamo"), non per ogni
richiesta.

## Ruoli e coordinamento

Claude Code è il coordinatore principale del lavoro: analizza la richiesta,
definisce e implementa il piano, integra i risultati e mantiene la
responsabilità della decisione finale. Un secondo modello (Gemini, tramite
`.github/workflows/ai_review.yml`) opera come reviewer indipendente, non come
secondo implementatore concorrente.

Il reviewer gira dentro GitHub Actions (non in locale): Claude lo lancia via
API (`workflow_dispatch` su `ai_review.yml`, input `prompt` + `base_ref` +
`head_ref`), aspetta il completamento e legge il risultato dal log del job
(`scripts/ai_review.py`, chiama l'API di Gemini con la chiave in
`GEMINI_API_KEY`). Funziona cosi' da qualunque sessione Claude Code — cloud,
locale, cellulare — perché non dipende da nulla installato su una macchina
specifica.

- Per modifiche significative, rischiose o trasversali, Claude deve chiedere
  questa review indipendente prima di concludere il lavoro.
- La richiesta deve essere circoscritta e concreta: indicare il task da
  verificare e i vincoli rilevanti nel `prompt`, e i `base_ref`/`head_ref`
  giusti per far vedere il diff che conta (di norma l'ultimo commit o l'intero
  lavoro della sessione rispetto a `origin/main`).
- Il reviewer è sempre sola lettura: non modifica mai file del repository, il
  workflow stesso non applica nulla in automatico.
- I suggerimenti del reviewer sono input di review, non decisioni automatiche:
  Claude deve verificarli criticamente nel contesto del repository (leggere il
  codice vero, non fidarsi ciecamente), accettando e applicando solo quelli
  corretti e pertinenti, e ignorando motivatamente gli altri.
- Prima di concludere un lavoro importante, Claude dovrebbe lanciare una
  review finale sul diff complessivo e risolvere o motivare gli eventuali
  rilievi sostanziali.

Nota: serve un secret `GEMINI_API_KEY` nel repository (API key gratuita da
Google AI Studio, https://aistudio.google.com/apikey — non richiede carta di
credito per il livello gratuito). Finché non è impostato il workflow fallisce
subito con un errore chiaro; a quel punto la review va chiesta all'utente
direttamente (es. lui stesso su ChatGPT/Gemini) invece che eseguita in
autonomia.

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
