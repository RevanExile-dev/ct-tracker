# ct-tracker

Per lo stato attuale del progetto e i prossimi passi (branch in corso, sync in
lavorazione, cosa manca), vedi la issue GitHub #1: "Stato progetto e prossimi
passi (nota di ripresa)". Consultala quando è rilevante per il compito
richiesto (es. "continua il lavoro", "a che punto siamo"), non per ogni
richiesta.

## Ruoli e coordinamento

Claude Code è il coordinatore principale del lavoro: analizza la richiesta,
definisce e implementa il piano, integra i risultati e mantiene la
responsabilità della decisione finale. Uno o più modelli di riserva (Gemini e
Groq, tramite `.github/workflows/ai_review.yml`) operano come reviewer
indipendenti, non come secondi implementatori concorrenti — nessuno dei due
scrive mai codice nel repository.

Il reviewer gira dentro GitHub Actions (non in locale): Claude lo lancia via
API (`workflow_dispatch` su `ai_review.yml`, input `prompt` + `base_ref` +
`head_ref` + `provider`), aspetta il completamento e legge il risultato dal
log del job (`scripts/ai_review.py`, chiama l'API del provider scelto con la
chiave del secret corrispondente). Funziona cosi' da qualunque sessione
Claude Code — cloud, locale, cellulare — perché non dipende da nulla
installato su una macchina specifica.

Due provider disponibili, entrambi a livello gratuito, per tre scopi
(specializzazione per tipo di verifica, fallback se uno finisce la quota,
secondo parere sulla stessa modifica quando vale la pena):
- **Gemini** (`provider: gemini`, default) — modello generalista, quota
  giornaliera per chiave, supporta chiavi di riserva (`GEMINI_API_KEY_2`,
  `_3`, ...) da account Google diversi.
- **Groq** (`provider: groq`) — hardware LPU molto veloce, modello
  `openai/gpt-oss-120b` confermato funzionante con una chiamata reale
  (`GET /v1/models` + una chat di prova, non solo documentazione). Utile
  come secondo parere rapido o come fallback quando Gemini è esaurito.
  Attenzione: il rate limit Groq è per organizzazione, non per chiave —
  aggiungere `GROQ_API_KEY_2` con una chiave dello stesso account non
  aumenta la quota reale, serve un account Groq diverso.

Provider scartati dopo verifica: GitHub Models (ritirato il 30/07/2026,
confermato con una chiamata reale che ha risposto
`github_models_retirement_brownout`). Grok e DeepSeek (nessun piano gratuito
stabile, solo pay-as-you-go — l'utente ha scelto di restare su provider
gratuiti). Qwen e Kimi/Moonshot (solo crediti di prova a scadenza, non un
piano gratuito stabile). GLM/Zhipu ha un piano gratuito reale ma richiede
registrazione con numero di telefono cinese (+86) — rimandato, non ne vale
la pena per 5 richieste/minuto.

- Uso deliberatamente ampio, non solo per modifiche rischiose: l'utente vuole
  che Gemini venga usato come alleggerimento del lavoro di verifica di
  Claude, per conservare piu' a lungo il proprio utilizzo di Claude stesso.
  Quindi, oltre alle modifiche significative/rischiose/trasversali, vale la
  pena chiedere questa review anche per verifiche di routine su un diff
  appena scritto, controlli di coerenza/edge case, o un secondo parere
  veloce — ogni volta che rileggere tutto a mano costerebbe a Claude piu'
  ragionamento di quanto costi delegare e leggere un riassunto. Non sostituisce
  pero' l'implementazione (resta di Claude) ne' i controlli che girano gia'
  gratis senza AI (build/typecheck in CI, vedi ci.yml) - a quelli non serve
  chiedere un parere a un modello.
- La richiesta deve essere circoscritta e concreta: indicare il task da
  verificare e i vincoli rilevanti nel `prompt`, e i `base_ref`/`head_ref`
  giusti per far vedere il diff che conta (di norma l'ultimo commit o l'intero
  lavoro della sessione rispetto a `origin/main`).
- Se il livello gratuito di Gemini dovesse risultare limitante (quota
  esaurita), l'utente ha detto di avere altre chiavi API disponibili da
  aggiungere: vale la pena segnalarglielo invece di rinunciare a usare il
  reviewer. `scripts/ai_review.py` gia' supporta chiavi di riserva: bastano
  nuovi secret `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, ... (numerati senza
  buchi, es. da un altro account Google) referenziati in
  `ai_review.yml` — usate automaticamente in ordine solo quando quella
  prima esaurisce la quota giornaliera (429 o 403 RESOURCE_EXHAUSTED),
  non su altri tipi di errore.
- Il reviewer è sempre sola lettura: non modifica mai file del repository, il
  workflow stesso non applica nulla in automatico.
- I suggerimenti del reviewer sono input di review, non decisioni automatiche:
  Claude deve verificarli criticamente nel contesto del repository (leggere il
  codice vero, non fidarsi ciecamente), accettando e applicando solo quelli
  corretti e pertinenti, e ignorando motivatamente gli altri.
- Prima di concludere un lavoro importante, Claude dovrebbe lanciare una
  review finale sul diff complessivo e risolvere o motivare gli eventuali
  rilievi sostanziali.

Nota: serve almeno il secret del provider che si vuole usare —
`GEMINI_API_KEY` (da Google AI Studio, https://aistudio.google.com/apikey) o
`GROQ_API_KEY` (da https://console.groq.com/keys) — nessuno dei due richiede
carta di credito per il livello gratuito. Finché il secret del provider
scelto non è impostato il workflow fallisce subito con un errore chiaro; a
quel punto la review va chiesta all'utente direttamente (es. lui stesso su
ChatGPT/Gemini) invece che eseguita in autonomia, oppure si prova l'altro
provider se il suo secret esiste.

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
