# Coordinamento multi-AI (Claude, ChatGPT, Gemini/Groq, [futuro] Perplexity)

Ultimo aggiornamento: 2026-08-31

Questo file descrive COME e QUANDO usare ogni AI collegata al progetto.
CLAUDE.md → "Ruoli e coordinamento" resta la fonte breve/riassuntiva; qui
sta il dettaglio meccanico e la strategia di delega.

## I quattro ruoli

- **Claude Code** — coordinatore. Pianifica, implementa il lavoro che
  richiede giudizio/iterazione empirica, decide cosa delegare, revisiona e
  fa il merge finale. Unico che tocca `main` e le branch `claude/*`.
- **ChatGPT** — implementatore delegato, autonomo ma isolato. Scrive codice
  SOLO su branch proprie (`chatgpt/task-<n>-<slug>`) e apre Draft PR, mai un
  merge diretto. Vedi "Canale di dispatch" sotto per la meccanica.
- **Gemini / Groq** (`scripts/ai_review.py`) — reviewer di sola lettura, mai
  implementatori. Restano com'erano, vedi CLAUDE.md. Un compito nuovo:
  quando Claude revisiona una Draft PR di ChatGPT, usa lo stesso meccanismo
  (non uno nuovo) per il controllo finale prima del merge.
- **Perplexity** (non ancora collegato, in arrivo con l'abbonamento Pro
  dell'utente) — pensato come un QUARTO ruolo di sola ricerca/fatti, non di
  scrittura codice: stesso principio di Gemini/Groq ("reviewer indipendenti,
  non secondi implementatori", CLAUDE.md). Uso previsto: domande fattuali che
  richiedono ricerca web aggiornata (es. calendario uscite set Pokémon,
  comportamento di un'API esterna, prezzi di mercato) — lo stesso tipo di
  lavoro che in questa sessione Claude ha fatto a mano con WebSearch,
  spendendo parecchio ragionamento per verificare fonti. Quando sarà
  collegato: Claude gli pone la domanda di ricerca, ne verifica criticamente
  la risposta (stesso principio "non fidarsi ciecamente" già in CLAUDE.md per
  Gemini/Groq) prima di usarla, sia per il proprio lavoro sia per fornire
  contesto a un task delegato a ChatGPT. Non richiede un canale di dispatch
  come ChatGPT: è consultabile direttamente (via API o WebFetch, da definire
  quando arriva il collegamento).

## Perché delegare a ChatGPT: economia dei token di Claude

L'obiettivo esplicito è alleggerire il consumo di token di Claude Code,
NON semplicemente distribuire lavoro a caso. Regola pratica: delegare i
task il cui costo maggiore per Claude sarebbe l'ESPLORAZIONE/scrittura di
routine più che il giudizio, e che hanno un criterio di accettazione
verificabile SENZA dover essere lì a guardare (Claude rilegge il diff finito,
non deve seguire il processo).

**Buoni candidati per ChatGPT:**
- Bug fix isolati con causa e criterio di accettazione già chiari (non serve
  la fase di indagine, solo l'implementazione) — es. "il pulsante X non
  chiude il pannello Y quando Z, il fix atteso è nel file W".
- Funzionalità nuove ma isolate a una pagina/componente che non toccano lo
  schema dati o la logica di prezzo.
- Estendere copertura di test Playwright già esistente (pattern chiaro da
  replicare).
- Pulizia/refactor a scope ristretto e ben delimitato (`Scope / likely
  files` piccolo).
- Documentazione, changelog, commenti — a basso rischio per definizione.

**Da tenere per Claude (mai delegare):**
- Qualunque redesign/architettura che richieda iterazione empirica dal vivo
  (build, Playwright, screenshot, ripetere finché non torna) — vedi il
  redesign dei filtri mobile di oggi: non sarebbe stato specificabile come
  ticket a priori, la scoperta dei bug reali (chiusura su tap, portale fuori
  da rootRef) è arrivata SOLO testando dal vivo con emulazione touch.
- Schema dati, logica di prezzo, sync CardTrader — esplicitamente il livello
  "conta di più" già riservato in CLAUDE.md ai controlli con Gemini/Groq;
  stesso principio, ChatGPT non tocca questa categoria.
- Qualunque cosa security-sensitive (secrets, permessi, auth).
- Merge su `main`, push diretti, decisioni di branching — restano
  esclusivamente di Claude.
- Task il cui criterio di accettazione non è specificabile in anticipo in
  modo netto (giudizio UX ambiguo, "vedi tu cosa sta meglio").

## Canale di dispatch: PR #6

`coord/chatgpt-dispatch` → PR #6 "Claude ↔ ChatGPT realtime dispatch
channel — DO NOT MERGE". Mai mergiata, mai chiusa, mai usata per sviluppo.
Serve solo come bus di eventi: un commento che comincia con `[CHATGPT]`
attiva il webhook di ChatGPT Work.

Formato del commento di delega (Claude → ChatGPT):

```
[CHATGPT]

Task: <titolo breve>

Objective:
<risultato da ottenere>

Context:
<solo il contesto necessario>

Acceptance criteria:
- ...

Scope / likely files:
- ...

Do not touch:
- ...

Base:
main

Notes:
<eventuali informazioni aggiuntive>
```

ChatGPT risponde sulla stessa PR #6 con branch, link alla Draft PR,
verifiche eseguite, eventuali limitazioni. Per correzioni su una Draft PR
già aperta, commento `[CHATGPT-REVISION]` con `PR: #<numero>` e
`Requested changes` — mai una nuova branch per lo stesso task.

Esiste anche un template Issue `[CHATGPT]` (`.github/ISSUE_TEMPLATE/
chatgpt-task.md`, da un giro precedente) — lasciato com'è come possibile
punto d'ingresso alternativo, ma il canale PRIMARIO/testato è PR #6.

## Come evitare di pestarsi i piedi

Stesso principio già in CLAUDE.md per i sync GitHub Actions
("verificare che nessun sync sia in corso prima di ogni push"), esteso a
ChatGPT:

1. **Prima di delegare un task**, Claude controlla che non tocchi file su
   cui sta già lavorando lui stesso in questo momento, e non modifica quei
   file finché la Draft PR di ChatGPT non è stata revisionata/mergiata o
   esplicitamente abbandonata.
2. `Do not touch` nel commento di delega deve essere concreto — elencare i
   file/branch attivi di Claude in quel momento, non lasciato vuoto per
   pigrizia.
3. ChatGPT controlla lato suo che non esista già una branch/PR equivalente
   (già specificato nel protocollo) — Claude non dovrebbe MAI dover
   scoprire un duplicato dopo il fatto, ma vale la pena un controllo veloce
   (`list_pull_requests` filtrando `chatgpt/*`) prima di aprire un nuovo
   task simile a uno già in corso.
4. **Ogni Draft PR di ChatGPT va revisionata da Claude con lo stesso rigore
   usato oggi per il branch `fix/mobile-filters-current-expansions`**: non
   fidarsi del diff a colpo d'occhio — leggerlo, buildare/lintare/testare
   in locale, e se il task è significativo lanciare comunque una review
   Gemini/Groq finale prima del merge (stesso principio "non sostituisce i
   controlli che girano già gratis" di CLAUDE.md). Se il task tocca UI
   mobile, applicare la lezione del punto 6 della Disciplina di verifica:
   verificare con emulazione touch reale, non solo resize del viewport.
5. Claude resta l'unico che fa il merge, dopo aver verificato che nessun
   sync GitHub Actions sia in corso (regola invariata).
