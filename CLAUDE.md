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

Due provider disponibili, entrambi a livello gratuito:
- **Gemini** — modello generalista, quota giornaliera per chiave, supporta
  chiavi di riserva (`GEMINI_API_KEY_2`, `_3`, ...) da account Google
  diversi. Trattato come il piu' "capace" dei due: riservato ai controlli
  che contano di piu', per non sprecarne la quota su banalita'.
- **Groq** — hardware LPU molto veloce (risposta in pochi secondi), modello
  `openai/gpt-oss-120b` confermato funzionante con una chiamata reale
  (`GET /v1/models` + una chat di prova, non solo documentazione). Quota
  giornaliera generosa ma per organizzazione, non per chiave — aggiungere
  `GROQ_API_KEY_2` con una chiave dello STESSO account non aumenta la quota
  reale, serve un account Groq diverso.

### Strategia di utilizzo (metodo di lavoro standard, non solo per casi eccezionali)

`scripts/ai_review.py` accetta un parametro `provider`: `gemini`, `groq`, o
`auto` (prova tutte le chiavi Gemini, solo se sono TUTTE esaurite passa
automaticamente a Groq — fallback vero tra provider, non solo tra chiavi
dello stesso). Uso previsto, per non esaurire nessuno dei due troppo in
fretta pur alleggerendo sul serio il lavoro di Claude:

- **Controlli di routine, frequenti, durante il lavoro** (un diff appena
  scritto prima di andare avanti, un controllo di coerenza/edge-case
  veloce, una verifica che non vale la pena rileggere a mano) →
  `provider: groq`, esplicitamente. È il più veloce e ha la quota
  giornaliera più ampia dei due: è il posto giusto per i controlli che si
  ripetono spesso in una sessione.
- **Controllo finale prima di concludere un lavoro significativo**, o su
  modifiche complesse/trasversali dove conta di più la qualità della
  revisione → `provider: auto` (quindi Gemini di default, con fallback
  automatico a Groq se la quota di Gemini è esaurita quel giorno). Non
  bisogna mai scegliere `groq` esplicitamente qui solo per "risparmiare"
  Gemini: se Gemini è disponibile va usato per i controlli che contano.
- **Secondo parere vero (entrambi i modelli sulla stessa modifica)** →
  riservato a modifiche davvero ad alto rischio (schema dati, logica di
  prezzo, sicurezza, qualcosa che l'utente ha segnalato come importante):
  due chiamate esplicite, una `provider: gemini` e una `provider: groq`,
  confrontando le due risposte. Non è il caso comune — raddoppia il
  consumo di entrambe le quote, va usato con giudizio.

Provider scartati dopo verifica: GitHub Models (ritirato il 30/07/2026,
confermato con una chiamata reale che ha risposto
`github_models_retirement_brownout`). Grok e DeepSeek (nessun piano gratuito
stabile, solo pay-as-you-go — l'utente ha scelto di restare su provider
gratuiti). Qwen e Kimi/Moonshot (solo crediti di prova a scadenza, non un
piano gratuito stabile). GLM/Zhipu ha un piano gratuito reale ma richiede
registrazione con numero di telefono cinese (+86) — rimandato, non ne vale
la pena per 5 richieste/minuto.

- Uso deliberatamente ampio e costante, non solo per modifiche rischiose:
  questo è il metodo di lavoro standard, non un'eccezione da attivare ogni
  volta di proposito. L'utente vuole che Gemini/Groq vengano usati come
  alleggerimento del lavoro di verifica di Claude, per conservare piu' a
  lungo il proprio utilizzo di Claude stesso. Quindi, oltre alle modifiche
  significative/rischiose/trasversali, vale la pena chiedere questa review
  anche per verifiche di routine su un diff appena scritto, controlli di
  coerenza/edge case, o un secondo parere veloce — ogni volta che rileggere
  tutto a mano costerebbe a Claude piu' ragionamento di quanto costi
  delegare e leggere un riassunto (vedi sopra quale provider scegliere caso
  per caso). Non sostituisce pero' l'implementazione (resta di Claude) ne'
  i controlli che girano gia' gratis senza AI (build/typecheck in CI, vedi
  ci.yml) - a quelli non serve chiedere un parere a un modello.
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

## Disciplina di verifica (non ripetere gli stessi errori)

Regole nate da errori reali commessi in sessione, non teoria astratta —
l'utente ha notato un pattern ("continui a dimenticarti di cose") e ha
chiesto una strategia vera, non solo la promessa di stare più attento.

**1. Un bug segnalato è un campione, non il problema intero.** Quando l'utente
mostra UN caso di un bug (uno screenshot, una pagina), quel caso quasi
sempre non è l'unica istanza — è la prova che esiste una classe di bug.
Prima di considerare il fix completo, cercare lo stesso pattern ovunque nel
codice, non solo dove l'utente ha guardato. Esempio reale (2026-08-30): un
bug di layout mobile (griglia senza colonna esplicita sotto un breakpoint,
dentro un contenitore con `aspect-ratio`) è stato corretto solo nella
versione "carta caricata" della pagina dettaglio — la versione "scheletro di
caricamento" della STESSA pagina, poche righe sotto, aveva lo stesso identico
pattern ed è rimasta rotta finché l'utente non ha richiesto esplicitamente
un secondo giro. Il grep per il pattern (`grid md:grid-cols`,
`aspect-\[`, ecc.) va fatto SUBITO dopo il primo fix trovato, non su
richiesta esplicita di un giro successivo. Vale anche per bug non-CSS:
un campo NULL non gestito, un filtro che assume un solo formato dati, una
query lenta — se la causa è strutturale, cercare altri punti del codice
che condividono la stessa struttura.

**2. Controllare tutti gli "stati" di una UI, non solo quello felice.** Ogni
pagina/componente con dati asincroni ha tipicamente 3+ varianti: caricamento
(skeleton), errore, vuoto, dati normali. Un fix testato solo sullo stato con
dati reali lascia gli altri stati non verificati per definizione — vanno
controllati esplicitamente (anche solo aprendo la pagina e guardando il primo
istante prima che i dati arrivino, come fatto nel giro di verifica del
2026-08-30 con Playwright su `domcontentloaded` invece di aspettare
`networkidle`).

**3. Chiedere ai reviewer AI non solo "è corretto questo diff" ma anche "cosa
potrei aver perso altrove".** Quando il fix è la correzione di un pattern
(non un bug isolato), includere esplicitamente nel prompt della review:
"Questo e' il fix di un\'istanza di [pattern]. Nel resto del diff/codice
c'e' un'altra istanza dello stesso pattern che potrei aver perso?" — i
reviewer vedono solo il diff passato, quindi la domanda va posta con
il contesto giusto (es. passare un base_ref più indietro per includere
i file rilevanti anche se non modificati in quel commit specifico,
se serve mostrare il pattern non ancora corretto altrove).

**4. Prima di ogni `git push`, verificare che nessun sync sia in corso** —
non solo una volta a inizio sessione. `list_workflow_runs` con
`workflow_runs_filter: {"status": "in_progress"}` prima di ogni push, senza
eccezioni, anche per un fix piccolo. Errore reale commesso due volte in
questa sessione (2026-08-30): push diretto su `main` mentre `sync_prices.yml`
era in corso, causando un fallimento del sync a metà — nonostante la regola
fosse scritta esplicitamente in questo stesso file/nella issue #1 e fosse
stata riletta poco prima.

**5. Prima di dire "fatto"/"tutto a posto" all'utente, un ultimo passaggio
esplicito**: rileggere l'elenco delle cose toccate in questo giro e chiedersi
"esiste un'altra istanza di ciascun pattern corretto, altrove nel codice o in
un altro stato della stessa UI?" — non è retorico, va effettivamente cercato
(grep/Read), non solo considerato a memoria.

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
