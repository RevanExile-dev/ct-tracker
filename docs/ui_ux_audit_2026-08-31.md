# Audit UI/UX — CartaViva (2026-08-31)

Audit read-only richiesto dall'utente: nessuna modifica di codice in questo
giro. Copre desktop e mobile, con focus su: card 3D/tilt/glow, filtri,
search, responsive, micro-interazioni, transizioni, loading states,
gerarchia visiva, spazi inutilizzati, feedback delle interazioni, WebGL.
Include una valutazione di 4 strumenti/reference esterni segnalati
dall'utente (getlayers.ai, canvasui.dev, transitions.dev, beautifului.dev).

Metodo: lettura diretta del codice attuale (`web/app`, `web/components`,
`web/lib`, `web/app/globals.css`, `tailwind.config.ts`), non solo
impressione visiva. Ogni punto cita file/riga dove rilevante. I punti sono
classificati Alto/Medio/Basso impatto UX **secondo il mio giudizio**; la
classificazione formale per impatto/difficoltà/performance/rischio/mobile
è richiesta come compito separato al reviewer ChatGPT (vedi commento su PR
#6) e va poi riconciliata.

Premessa importante: il sistema attuale (tilt 3D via CSS transform +
custom properties, bordo olografico, glow che segue il puntatore, entrata a
cascata, price-line animata, binder con page-flip 3D, hide-on-scroll,
skeleton, count-up) è già sostanzialmente più curato della media di questo
tipo di progetto. L'audit cerca **gap reali rispetto a questo livello**, non
un elenco generico di "aggiungi animazioni".

---

## 1. Card Pokémon: interazione 3D/tilt/glow

File: `web/components/InteractiveCard.tsx`, `web/app/globals.css`
(`.interactive-card` e derivati).

**Cosa c'è oggi:** tilt via `pointermove`/rAF su `--card-transform`, bordo
olografico animato (`::before`), glow radiale che segue il cursore
(`::after`), ombra dinamica, tre livelli di intensità (`detail`/`binder`/
`tile`), reveal 3D all'apertura della pagina carta, rispetto di
`prefers-reduced-motion`. Tecnicamente solido: solo `transform`/`opacity`/
custom properties, nessun reflow, throttle via rAF.

**Gap reali trovati:**

- **[Alto] L'effetto firma è quasi invisibile su mobile in uso normale.**
  Il tilt si attiva su `pointerdown` + movimento (drag reale), non su un
  semplice tap (`InteractiveCard.tsx:83-112`). Su desktop il tilt scatta
  anche al solo hover/passaggio mouse; su touch NO — serve pressione e
  trascinamento intenzionali. Nel flusso reale (tap per aprire la carta),
  la maggior parte degli utenti mobile non vede mai l'effetto che rende il
  sito "premium": tocca e naviga via prima che succeda niente. È la stessa
  asimmetria desktop/mobile che ha già causato più bug reali in sessione
  (l'hover non esiste su touch). Non è un bug, ma è uno spreco: l'elemento
  di interazione più curato del sito è tarato sulla piattaforma minoritaria
  d'uso reale (l'utente stesso è su telefono la maggior parte del tempo,
  a giudicare dai round di bug fix di oggi).
- **[Medio] Nessuna variazione dell'effetto per rarità.** Il gradiente
  olografico (`--card-angle`, colori fissi teal→pink→gold) è identico per
  una Common e per una Secret/Illustration Rare (`globals.css:100-119`).
  Le carte fisiche reali variano il tipo di foil per rarità (reverse holo,
  cosmos, rainbow) — è un'aspettativa concreta di chi colleziona Pokémon
  TCG, non un vezzo estetico astratto. Modulare intensità/velocità
  shimmer/ampiezza tilt in base a `card.rarity` darebbe sia più "wow" sulle
  carte che contano sia un segnale di gerarchia visiva gratuito nella
  griglia (le rare "brillano" di più a colpo d'occhio).
- **[Basso] Nessuno zoom/lightbox sull'immagine grande in pagina
  dettaglio.** `card/[id]/page.tsx:159-180`: l'immagine è dentro
  `InteractiveCard` ma non è ingrandibile (pinch-zoom nativo del browser a
  parte). Per un tracker dedicato a carte fisiche, poter ispezionare i
  dettagli dell'immagine (centratura, difetti di stampa) ha valore concreto
  per un collezionista, non solo estetico.

---

## 2. Filtri e organizzazione

File: `web/components/Toolbar.tsx`, `web/components/FilterDropdown.tsx`,
`web/app/page.tsx`.

Il sistema filtri ha appena attraversato un redesign multi-round in questa
sessione (stacking mobile, modale centrato, hide-on-scroll) — è oggi
strutturalmente solido. I gap restanti sono di rifinitura, non di rottura:

- **[Medio] Nessun riepilogo "chip" delle selezioni attive.** Ogni
  `FilterDropdown` mostra solo un numeretto sul trigger
  (`FilterDropdown.tsx:223-225`) — per vedere/togliere UNA rarità
  selezionata tra tre bisogna riaprire il pannello. Una riga di chip
  rimovibili sotto la toolbar (pattern e-commerce standard) darebbe
  feedback immediato di "cosa sto filtrando" senza dover riaprire nulla, e
  renderebbe il pulsante "✕ Reset filtri" meno un atto di fede (oggi sparisce
  tutto senza che l'utente veda esplicitamente cosa stava per perdere).
- **[Medio] Il `<select>` di ordinamento rompe il linguaggio visivo appena
  costruito.** `Toolbar.tsx:118-130` usa un `<select>` nativo mentre ogni
  altro filtro è stato appena portato a un modale centrato custom
  (`FilterDropdown.tsx`) proprio su richiesta esplicita dell'utente. Su iOS
  un `<select>` nativo apre uno sheet di sistema completamente diverso
  (font, colori, animazione) da tutto il resto dell'app — l'unico punto
  dell'interfaccia filtri rimasto "non CartaViva". Candidato naturale per
  diventare un `FilterDropdown` a selezione singola (il componente supporta
  già `layout="list"`).
- **[Basso] Nessun conteggio risultati vicino alla ricerca.** Cambiare
  filtro/ricerca non mostra mai "142 carte trovate" finché non si scorre la
  griglia — feedback di conferma assente nel punto in cui serve di più
  (subito dopo l'azione).
- **[Basso] Iconografia mista.** Emoji (⚡ 📈 📚 ♡ ✕) e glifi unicode (▸ ▲)
  convivono senza un sistema — dettaglio che pesa sulla percezione
  "premium" più di quanto costerebbe sistemarlo (icone SVG coerenti, stesso
  stroke-width, stessa griglia).
- **Da verificare empiricamente, non solo in lettura:** l'interazione tra
  il nuovo hide-on-scroll (`page.tsx:213-265`, spedito poche ore fa) e un
  `FilterDropdown` aperto e ancorato (`position: absolute` al trigger,
  `FilterDropdown.tsx:237`) — se l'utente apre un filtro e poi la toolbar si
  comprime per scroll, il pannello ancorato potrebbe restare "appeso" a un
  trigger che si è mosso o è sparito. Non l'ho verificato con Playwright in
  questo giro (audit read-only), lo segnalo come rischio da testare prima
  di considerarlo chiuso.

---

## 3. Search

File: `web/app/page.tsx:108-119`, `web/lib/db.ts:180-182`.

- **[Alto, confermato leggendo il codice] Nessun debounce sulla ricerca.**
  `fetchCards` viene richiamata nell'`useEffect` che dipende da `search` ad
  ogni singolo carattere digitato (`page.tsx:108-119`), ed esegue una query
  `LIKE` su un database SQLite caricato in WASM nel browser via sql.js
  (`db.ts:180-182`) — non un indice server-side. Ogni tasto premuto rilancia
  una query completa, comprese le query per stati intermedi scartati subito
  dopo ("p", poi "pi", poi "pik"…). Su un catalogo di alcune migliaia di
  carte l'impatto percepito dipende dalla velocità reale di sql.js/WASM su
  quel volume — non l'ho misurato in questo giro (read-only) — ma è un
  pattern strutturalmente sbagliato indipendentemente dal fatto che oggi si
  senta o no: nessuna ragione per NON debounciare (200-300ms) o passare a
  `useDeferredValue`, a costo zero di UX percepita in positivo e certo
  risparmio di lavoro reale.
- **[Basso] Nessun pulsante "×" per svuotare la ricerca dall'input
  stesso** — oggi bisogna selezionare e cancellare a mano, o usare "Reset
  filtri" che però azzera tutto, non solo il testo.
- **[Basso] Nessuna scorciatoia da tastiera** (es. `/` per mettere il focus
  sulla ricerca) — pattern ormai comune, costo di implementazione minimo.

---

## 4. Responsive mobile/tablet

- **[Medio] Buco di breakpoint tablet nella griglia principale.**
  `page.tsx:334`: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` — tra 640px e
  1024px (tablet portrait/landscape stretto, fascia d'uso reale non
  trascurabile) restano 3 colonne dentro un contenitore `max-w-7xl` molto
  più largo: le card diventano grandi rispetto al loro contenuto
  informativo e/o restano margini laterali sproporzionati. Manca uno step
  `md:grid-cols-4`.
- **[Basso] 2 colonne su telefoni stretti (~360-390px) sono dense.** Ogni
  tile (`CardTile.tsx`) impacchetta immagine + espansione + nome + prezzo +
  bandiera lingua + badge NM Zero + delta in una colonna di ~170px. Il
  `flex-wrap` esistente evita overflow, ma non ho verificato visivamente su
  viewport reale se il blocco prezzo si spezza in modo elegante o
  "affollato" quando tutti gli elementi sono presenti insieme (carta NM
  Zero + variazione prezzo + lingua non IT) — da controllare con
  screenshot reale, non assunto.
- **[Basso] Lista "Migliori inserzioni" in pagina carta** non ha un tetto
  di altezza/scroll interno su mobile — con molte inserzioni salvate (fino
  a 25 per carta, vedi `_pick_best_listing`/fase 2 del piano precedente) lo
  scroll della pagina si allunga parecchio. Probabilmente accettabile, non
  urgente.

Da notare in positivo: il binder 3D (`globals.css:501-643`) ha già
breakpoint dedicati (single-page sotto 768px/tablet portrait,
`perspective`/`aspect-ratio` ricalcolati) — livello di cura sopra la media,
nessun gap trovato lì.

---

## 5. Micro-interazioni

- **[Medio] `CountUp` (già costruito, già usato per il riepilogo
  espansione in `page.tsx:279-282`) non è riusato per il delta di prezzo
  nella singola `CardTile`** (`CardTile.tsx:158-166`, valore statico).
  Incoerenza gratuita: la primitiva esiste già, il costo di riuso è quasi
  zero, il beneficio (numeri che si animano invece di scattare ad ogni
  refetch/filtro) è coerente con quanto già fatto altrove.
- **[Basso] Nessun feedback esplicito su "Reset filtri".** Il pulsante
  (`Toolbar.tsx:172-180`) cambia lo stato silenziosamente — specie ora che
  la toolbar può essere scrollata fuori vista, l'utente potrebbe non vedere
  subito l'effetto del click.
- **[Basso] Placeholder immagine "spento".** `CardTile.tsx:74-77`: durante
  il caricamento l'immagine è a `opacity-0` su sfondo `bg-surface2` piatto
  — funziona ma non comunica "sta arrivando qualcosa" quanto un blur-up o
  uno shimmer dedicato (lo skeleton pulse esiste già come pattern nel
  progetto, solo non applicato qui al posto del semplice fade).

---

## 6. Transizioni

- **[Alto, idea con potenziale reale] Nessuna continuità visiva
  griglia → pagina carta.** Oggi: click sulla tile → navigazione Next.js
  standard (hard swap) → `card-reveal` riparte da zero sulla pagina di
  dettaglio (`globals.css:214-234`, `card/[id]/page.tsx:158`). L'immagine
  che hai appena visto nella griglia sparisce e ne ricompare una nuova,
  più grande, con un'animazione scollegata dalla posizione/dimensione di
  partenza. La **View Transitions API** del browser (supportata da Next.js
  in App Router, gestibile per-navigazione) permetterebbe alla carta
  cliccata di "crescere" visivamente fino a diventare l'hero della pagina
  di dettaglio — è esattamente la categoria di pattern che cataloga
  transitions.dev (transizioni di pagina/elemento con guardia
  `prefers-reduced-motion` incorporata, coerente con la convenzione già
  in uso in questo progetto). Rischio: supporto browser non universale
  (richiede fallback pulito, che è comunque il comportamento odierno) e va
  verificato che non interferisca con lo scroll-restoration già presente
  (`useScrollRestoration`).
- **[Da verificare] Re-stagger della griglia ad ogni variazione filtro.**
  `CardTile.tsx:10-11,55,60-62`: ogni carta ha un `--enter-delay` basato sul
  suo indice e l'animazione `card-enter` riparte (`globals.css:203-206`)
  quando il componente rimonta. Se React sta rimontando l'intera lista ad
  ogni variazione di `cards` (probabile, dato che la key è `card.id` ma
  l'array intero cambia riferimento ad ogni fetch — non necessariamente un
  remount di OGNI nodo, dipende dalla reconciliation) l'ingresso a cascata
  potrebbe ripartire anche per un singolo tasto in ricerca (aggravato dal
  punto 3, mancanza di debounce): tanti micro-restagger di fila leggono
  come "sfarfallio" invece che come l'effetto premium voluto in un
  caricamento singolo. Non affermo che accada — va profilato, non assunto.

---

## 7. Loading states

- **[Medio] Nessun indicatore durante un refetch di filtro (solo al primo
  caricamento).** `page.tsx:31,108-119`: `cards` parte `null` solo alla
  prima visita; da lì in poi ogni cambio filtro sovrascrive silenziosamente
  l'array quando la promise risolve, senza stato intermedio visibile. Per
  una query lenta (catalogo grande, dispositivo lento) l'utente non ha
  alcun segnale che "sta succedendo qualcosa" tra l'azione e il nuovo
  risultato — diverso, e più delicato, dal semplice skeleton visto al
  primo load (qui rifarlo identico causerebbe lo sfarfallio del punto 6).
  Serve un indicatore leggero (es. dimming/spinner discreto sul contenitore
  griglia), non un reset completo.
- **[Alto per tono, non per frequenza] Il messaggio d'errore è scritto per
  chi sviluppa, non per chi usa il sito.** `page.tsx:291-300`: cita
  `web/public/data/cardtrader.db` e "verifica che il workflow... sia già
  stato eseguito" — linguaggio operativo interno, non un messaggio
  pensato per un utente reale che vede un errore. Nessun pulsante
  "Riprova". Capita raramente (serve un fallimento di fetch dei DB), ma
  quando capita è la peggior prima impressione possibile.

---

## 8. Gerarchia visiva

- **[Medio] "Inserzioni attive" ha lo stesso peso visivo del prezzo in
  evidenza.** `card/[id]/page.tsx:238-284`: due riquadri identici in una
  griglia 2 colonne — prezzo (la decisione primaria) e conteggio inserzioni
  (informazione secondaria) competono alla pari. Il prezzo dovrebbe vincere
  chiaramente (dimensione, contrasto), il conteggio essere un dettaglio più
  discreto.
- **[Medio] L'header non-compatto costa spazio verticale ad ogni visita
  della home**, la pagina a più traffico. `SiteHeader.tsx:54-74`: paragrafo
  descrittivo + riga "ultimo aggiornamento" + tre bottoni di navigazione,
  tutto prima di vedere una sola carta. La sessione ha appena investito
  parecchio lavoro per recuperare spazio verticale sui filtri
  (hide-on-scroll) mentre questo blocco, altrettanto costoso in altezza e
  presente ad OGNI visita (non solo dopo aver scrollato), non ha ricevuto
  lo stesso trattamento. Non necessariamente va reso "compact" come nelle
  pagine secondarie (perderebbe contesto utile alla prima visita), ma
  merita la stessa attenzione: es. collassare subtitle+lastSync dopo il
  primo scroll, o restringerlo su mobile specificamente.
- **[Basso] I tre bottoni di navigazione hanno peso uguale** (stesso
  stile bordo+emoji) indipendentemente da quanto siano centrali —
  leggibile ma "piatto", non comunica una gerarchia tra azioni primarie e
  secondarie.

---

## 9. Spazi inutilizzati

- Buco breakpoint tablet già coperto al punto 4.
- **[Basso] Nessuna colonna aggiuntiva su desktop molto larghi.**
  `page.tsx:206`: contenitore `max-w-7xl` (1280px), griglia ferma a 5
  colonne anche oltre 1920px di viewport — su un monitor largo restano
  centinaia di pixel di solo sfondo "aurora" ai lati. Un `2xl:grid-cols-6`
  userebbe lo spazio in modo produttivo invece di semplicemente
  ingrandire il container.

---

## 10. Feedback delle interazioni

Il sistema di feedback tattile esistente è già buono e coerente
(`active:scale-95` ovunque, `focus-visible:ring` per tastiera, pop
animation su star/heart, glow al focus sulla ricerca) — pochi gap reali:

- Reset filtri e conteggio risultati già coperti sopra (punti 2/3).
- **[Basso] Nessuna funzione "copia link"/condividi su una carta filtrata.**
  L'infrastruttura esiste già (i filtri sono sincronizzati nell'URL,
  `page.tsx:76-88`) — manca solo un pulsante esplicito per copiare il link
  corrente, utile per un collezionista che vuole condividere "guarda questa
  carta a questo prezzo" con qualcuno. Costo di implementazione basso dato
  che l'infrastruttura è già pronta.

---

## 11. WebGL: dove porta valore reale (e dove no)

Valutazione diretta, non solo enumerativa:

- **Sulla griglia carte (decine di tile per pagina): sconsigliato.**
  L'effetto CSS attuale (tilt + glow + bordo olografico, tutto
  `transform`/`opacity`) è già GPU-friendly e visivamente convincente.
  Sostituirlo con shader WebGL/canvas per-tile (es. approccio
  "html-in-canvas" di canvasui.dev) moltiplicherebbe il costo per il
  numero di card visibili in griglia (fino a decine per pagina), un rischio
  di performance reale sulla piattaforma che questa sessione ha già
  dimostrato essere la più fragile (mobile) — a fronte di un guadagno
  visivo marginale sopra un effetto CSS già buono.
- **Su un singolo elemento hero: potenzialmente valido, da prototipare,
  non da adottare a scatola chiusa.** L'unica card grande in pagina
  dettaglio (`card/[id]/page.tsx:159-180`) è un candidato ragionevole per
  UN effetto WebGL più ricco (rifrazione vetro/foil vero, alla
  canvasui.dev) proprio perché è un'istanza sola per pagina, non
  paginata per decine. Da trattare come esperimento con feature-detection
  e fallback CSS (quello attuale), disattivato su `prefers-reduced-motion`
  e su dispositivi a bassa potenza — non come sostituzione garantita.
- Nessun altro punto del sito (binder cover, grafico prezzi) giustifica
  WebGL: sono elementi a bassa frequenza dove l'attuale soluzione CSS
  (`binder-cover-shine`, path SVG animato) è già proporzionata al loro
  ruolo.

---

## Valutazione delle 4 risorse esterne segnalate

Fetch diretto ai domini bloccato dal proxy di rete di questo ambiente
(`EGRESS_BLOCKED` su tutti e quattro) — valutazione basata su ricerca
web (WebSearch), non su ispezione diretta del sito. Da verificare di
persona prima di qualunque adozione.

| Sito | Cos'è davvero | Rilevanza per CartaViva |
|---|---|---|
| **canvasui.dev** | Libreria open source "html-in-canvas": componenti reali (React/Vue/Svelte/vanilla) che fanno girare shader WebGL sopra DOM live (particelle, vetro, fluido, glitch), distribuita via registry shadcn (si scarica il file sorgente nel progetto, non una dipendenza black-box). | **La più pertinente delle quattro**, ma solo per il punto 11 sopra (un singolo elemento hero, non la griglia). Il modello di distribuzione (file sorgente leggibile/modificabile, non un pacchetto npm pesante) è adatto allo stile del progetto (niente dipendenze non necessarie). |
| **transitions.dev** | Raccolta di snippet CSS/React copia-incolla per transizioni UI comuni (modali, dropdown, skeleton, badge), con guardia `prefers-reduced-motion` già incorporata, pensata per essere usata anche via skill da un agente. | **Pertinente per il punto 6** (transizioni pagina/elemento) più come *riferimento di pattern* che come dipendenza — il progetto scrive già le proprie transizioni CSS a mano con lo stesso principio (motion tokens in `globals.css:5-11`, guardia reduced-motion sistematica), quindi il valore è "confrontare i propri pattern con i loro" più che importare codice. |
| **getlayers.ai** | Libreria curata di prompt/template/scene 3D pensata per generare landing page con un tool AI generico (si copia un prompt, non del codice) — rivolta a chi genera siti da zero con AI, non a un progetto Next.js esistente con un design system già definito. | **Bassa rilevanza diretta.** Utile al più come moodboard d'ispirazione per la scena di copertina del binder o una futura landing page, non come strumento da integrare nel codice. |
| **beautifului.dev** | Componenti curati per interfacce "AI-native" (chat, stati di pensiero/streaming, card di approvazione, diff) — dominio applicativo (agenti conversazionali) distante da un tracker di prezzi carte. | **Bassa rilevanza.** Nessun componente del catalogo mappa a un bisogno reale di CartaViva; utile al più come riferimento di qualità/cura generale dei micro-dettagli, non come fonte di componenti da adottare. |

---

## Esito della seconda opinione (Gemini, `ai_review.yml` run #23)

Riassunto critico, non trascrizione integrale (log completo nel workflow
"AI review" su questo branch). Verificato punto per punto contro il codice
reale prima di accettarlo, come da disciplina del progetto — non preso per
buono a scatola chiusa.

**Confermato come problema reale e prioritario** (accordo pieno): mancanza
di debounce sulla ricerca (punto 3), messaggio d'errore dev-facing (punto
7), `<select>` nativo incoerente (punto 2), buco breakpoint tablet
(punto 4).

**Correzioni accettate al mio ragionamento:**

- **Tilt/glow su tap mobile (punto 1) — rischio che avevo sottovalutato.**
  Gemini nota che un'animazione di tilt avviata sul tap introdurrebbe un
  ritardo percepito prima della navigazione (l'utente su mobile si aspetta
  reattività immediata: tap → pagina). Accolgo la critica: **l'alternativa
  "shimmer ambient periodico"** che avevo già proposto come opzione B è
  la scelta più sicura, non il tilt-su-tap come opzione principale.
- **View Transitions API griglia→dettaglio (punto 6) — rischio tecnico che
  avevo sottostimato.** Cross-route View Transitions in Next.js App Router
  sono ancora un'area delicata (richiedono lavoro extra per integrarsi
  bene con l'App Router) e possono interagire male con
  `useScrollRestoration`, già presente e già fonte di un bug reale in
  passato in questa sessione. Declassato da "idea con potenziale reale" a
  **prototipo a rischio, da validare in isolamento prima di qualunque
  adozione** — non un intervento a basso rischio.
- **Effetto olografico per rarità (punto 1) — riclassificato.** È una
  richiesta di funzionalità/estetica legittima per un tracker di carte da
  collezione, non la correzione di un gap di usabilità: lo tratto come tale
  nella classificazione finale, non allo stesso livello dei problemi
  strutturali sopra.

**Tensione interna segnalata, valida:** propongo sia di aver appena
verificato l'hide-on-scroll della toolbar filtri (già spedito) sia di
applicare lo stesso trattamento all'header (punto 8) — due elementi
indipendenti che si comprimono/nascondono allo scroll aumentano il rischio
di layout shift e di collisioni z-index con pannelli filtro aperti. Se
questo intervento verrà mai implementato, va trattato come **un singolo
sistema di scroll behavior condiviso tra header e toolbar**, non due hook
`useHideOnScrollDown` indipendenti — annotato nel riepilogo finale.

**Nuovi pattern trovati da Gemini, verificati e confermati reali** (li
aggiungo alla lista, non erano nel mio giro):

- **[Nuovo] Nessun fallback per immagini che falliscono il caricamento.**
  Verificato via grep: nessun `onError`/`onerror` in tutto `web/components`.
  Un URL immagine CardTrader morto (404, CDN irraggiungibile) lascia oggi
  un riquadro vuoto/rotto invece di un'immagine placeholder (es. il retro
  di una carta Pokémon) — pattern mancante sia in `CardTile.tsx` sia in
  `InteractiveCard`/pagina dettaglio.
- **[Nuovo] Tooltip `title=` invisibili su touch — stesso pattern
  dell'asimmetria hover/tap già trovato per il tilt 3D, ma più esteso.**
  Verificato via grep: l'attributo `title` (tooltip nativo del browser, che
  su praticamente nessun browser mobile è raggiungibile via tap/long-press)
  è usato 8 volte in 5 file (`CardTile.tsx`, `ConditionBadge.tsx`,
  `Toolbar.tsx`, `FilterPresetControls.tsx`, `card/[id]/page.tsx`) per
  spiegazioni non banali: lingua della carta, badge "NM Zero", nome
  condizione per esteso, paese di spedizione, media prezzo N giorni. Su
  desktop questi dettagli sono scopribili via hover; **su mobile sono
  semplicemente persi**, non solo meno comodi — stesso principio
  dell'asimmetria già segnalata al punto 1, qui applicato sistematicamente
  invece che a un solo componente.

**Claim di Gemini verificato e scartato (non un gap reale):** ha segnalato
come mancante uno stato "0 risultati" — verificato in `page.tsx:326-330`,
esiste già ("Nessuna carta trovata. Prova a modificare la ricerca o i
filtri."). Falso positivo dovuto al fatto che il reviewer vede solo il
diff (il documento di audit), non l'intero codice sorgente — confermato
perché in questo caso avevo il file aperto io stesso. Non incluso nel
riepilogo.

**Claim di Gemini non verificabile senza ulteriore lettura, non incluso per
ora:** ipotesi che esistano campi filtro numerici (es. intervallo di
prezzo min/max) con lo stesso problema di debounce del punto 3. Verificato:
**non esiste alcun filtro di intervallo prezzo nel codice attuale** — il
campo di ricerca testuale in `FilterDropdown` (prop `searchable`, usato dal
filtro espansioni) filtra un array già in memoria via JS, non una query SQL
ripetuta — natura del problema diversa (costo trascurabile), quindi non
equiparabile al punto 3. Nessuna azione aggiuntiva necessaria qui.

---

## Riepilogo — modifiche candidate (non implementate)

Elenco piatto per la revisione ChatGPT/riconciliazione finale, senza
priorità ancora assegnata in modo formale (richiesta come compito separato
al reviewer):

1. **[Feature request, non bug]** Modulare tilt/glow/shimmer della carta
   per rarità.
2. Rendere l'effetto 3D visibile nel flusso d'uso reale su mobile —
   **non** con tilt sul tap (rischio input-lag percepito prima della
   navigazione, criticato da Gemini e accolto), ma con uno shimmer ambient
   periodico leggero indipendente dal tocco.
3. Zoom/lightbox sull'immagine carta in pagina dettaglio.
4. Riga di chip rimovibili per i filtri attivi.
5. Sostituire il `<select>` ordinamento con un `FilterDropdown` coerente.
6. Conteggio risultati visibile vicino a ricerca/filtri.
7. Icone coerenti (SVG) al posto delle emoji miste.
8. Verificare (Playwright reale) l'interazione hide-on-scroll ×
   FilterDropdown aperto.
9. Debounce sulla ricerca (o `useDeferredValue`).
10. Pulsante "×" per svuotare la ricerca; scorciatoia `/` per il focus.
11. Aggiungere breakpoint `md:grid-cols-4` alla griglia principale.
12. Verificare visivamente la densità della griglia a 2 colonne su
    telefoni stretti con tutti i badge presenti insieme.
13. Riusare `CountUp` per il delta di prezzo nella `CardTile`.
14. Feedback esplicito su "Reset filtri".
15. Placeholder immagine più curato durante il caricamento (blur-up/shimmer
    invece di fade su sfondo piatto).
16. **[Rischio tecnico reale, non "basso rischio"]** Prototipo View
    Transitions API per la navigazione griglia → dettaglio, DA VALIDARE IN
    ISOLAMENTO prima di adottare: interazione cross-route in Next.js App
    Router ancora delicata, rischio concreto di regressione su
    `useScrollRestoration`.
17. Profilare se il re-stagger della griglia si ripete indesideratamente
    ad ogni variazione di filtro/ricerca.
18. Indicatore leggero di refetch-in-corso sulla griglia filtri (non un
    reset completo dello stato di caricamento).
19. Riscrivere il messaggio d'errore caricamento DB in linguaggio
    utente-facing, con pulsante "Riprova".
20. Ridurre il peso visivo di "Inserzioni attive" rispetto al prezzo in
    evidenza in pagina carta.
21. Recuperare spazio verticale dell'header non-compact sulla home
    (stesso obiettivo dell'hide-on-scroll toolbar, applicato all'header) —
    **se implementato insieme al punto 8 (hide-on-scroll toolbar già
    live), va progettato come UN sistema di scroll behavior condiviso
    header+toolbar, non due hook indipendenti**: rischio segnalato da
    Gemini di layout shift/collisioni z-index altrimenti.
22. Pulsante "copia link" su una carta/vista filtrata.
23. `2xl:grid-cols-6` per desktop molto larghi.
24. Prototipo WebGL (es. pattern canvasui.dev) mirato SOLO alla card hero
    della pagina dettaglio, con fallback CSS e feature-detection — non
    sulla griglia. Gemini è più scettico di me sul rapporto costo/beneficio
    anche per questo singolo caso: da trattare come esperimento a basso
    impegno con criterio di stop chiaro, non come intervento pianificato.
25. **[Nuovo, da revisione Gemini, verificato]** Fallback per immagini che
    falliscono il caricamento (nessun `onError` in tutto `web/components`
    oggi) — placeholder dedicato invece di un riquadro rotto/vuoto.
26. **[Nuovo, da revisione Gemini, verificato]** I tooltip `title=` nativi
    (8 occorrenze in 5 file: lingua, badge NM Zero, condizione, paese di
    spedizione, media prezzo) sono invisibili su touch — stesso principio
    dell'asimmetria hover/tap del punto 1/2, qui sistemico. Servirebbe un
    meccanismo esplicito tap-to-reveal per queste informazioni su mobile,
    non solo l'attributo HTML nativo.

## Esito della revisione ChatGPT (PR #6, commento del 2026-08-31 15:13 UTC)

Riassunto critico, non trascrizione integrale (testo completo nel commento
sulla PR #6). Tre affermazioni chiave verificate direttamente sul codice
prima di accettarle — non prese per buone a scatola chiusa, come da
disciplina del progetto.

**La scoperta più importante di questo intero giro di revisione, verificata
di persona riga per riga:** `web/lib/page.tsx`/`fetchCards()` in
`web/lib/db.ts` **non applica mai un `LIMIT` SQL quando chiamato dalla
home** (`opts.limit` è `undefined` lì) — la query scarica e materializza
in oggetti JS **l'intero catalogo che soddisfa i filtri correnti** (dell'ordine
di 30.000+ righe a catalogo pieno, per un commento nello stesso file), e
solo DOPO `page.tsx` taglia a 60 con uno `.slice()` in JavaScript
(`visibleCount`). Questo accade ad OGNI cambio di ricerca/filtro, non solo
al primo caricamento — si somma direttamente al problema già trovato
(punto 9, nessun debounce): oggi ogni tasto premuto nella ricerca rilancia
una query SQL che restituisce e converte in memoria decine di migliaia di
righe, di cui se ne mostrano 60. Questo è quasi certamente il singolo
intervento con il rapporto valore/sforzo più alto di tutto l'audit — non
un problema di "polish", un problema architetturale reale con impatto
diretto su tempo di risposta e memoria, soprattutto su mobile.

**Bug concreto aggiuntivo trovato verificando la nota di ChatGPT sul
retry dell'errore di caricamento (punto 19):** `getDb()`/`getHistoryDb()`
in `web/lib/db.ts` mettono in cache una Promise **anche quando fallisce**
(`dbPromise = (async () => {...})()`, mai resettata a `null` in caso di
errore). Verificato leggendo il codice: se il fetch del database fallisce
una sola volta (rete instabile, file temporaneamente assente), **l'intero
sito resta rotto per il resto di quella sessione del browser** — ogni
chiamata successiva a `getDb()` restituisce la stessa Promise già
rifiutata, un ricaricamento di pagina è l'unico modo per riprovare. Un
eventuale pulsante "Riprova" (punto 19 dell'audit) è inutile senza
sistemare prima questo — va risolto insieme, non separatamente.

**Altri problemi reali trovati da ChatGPT, verificati sul codice attuale:**

- **`CardTile.tsx` — bottone dentro link (HTML non valido).** Confermato:
  l'intera tile è un `<Link>` (→ `<a>`) e i bottoni stella/cuore sono
  `<button>` annidati al suo interno con `stopPropagation` sul pointer.
  Contenuto interattivo dentro contenuto interattivo — non valido in
  HTML5, comportamento ambiguo per tastiera/screen reader indipendentemente
  da `stopPropagation` (che ferma solo la propagazione del click, non
  risolve il problema semantico).
- **`PriceChart.tsx` — interamente inaccessibile su touch e da tastiera.**
  Confermato: l'unica interazione (`onMouseEnter`/`onMouseLeave` su `<rect>`
  invisibili per scorrere la storia dei prezzi) non ha alcun equivalente
  touch/pointer/keyboard. Su mobile il grafico mostra sempre e solo l'ultimo
  punto — un'intera funzionalità (esplorare lo storico) è di fatto assente
  per la maggioranza degli utenti reali di questo progetto, un impatto
  concreto più alto di molte voci "micro-interazioni" dell'audit originale.
- **`FilterDropdown.tsx` — focus non ripristinato in modo coerente alla
  chiusura.** Confermato leggendo il codice: il percorso Escape chiama sia
  `close()` sia `focusTrigger()` (righe 127-128); i percorsi ✕ e tap sul
  backdrop chiamano solo `close()` (righe 255, 272), senza restituire il
  focus al trigger. Inconsistenza verificabile, non ipotetica.
- **Target di tocco incoerenti.** Confermato: i bottoni stella/cuore in
  `CardTile.tsx` sono `w-7 h-7` (28px), mentre altrove nello stesso
  progetto (`Toolbar.tsx`, `BinderBook.tsx`, i bottoni ✕/chiudi in
  `FilterDropdown.tsx`) si usa sistematicamente `min-h-11`/`min-w-11`
  (44px, la soglia raccomandata). Incoerenza reale tra componenti dello
  stesso codebase.
- **Ricerca senza etichetta accessibile.** Confermato: l'`<input>` di
  ricerca in `Toolbar.tsx` ha solo `placeholder`, nessun `aria-label` né
  `<label>` associato (a differenza della ricerca interna a
  `FilterDropdown`, che invece ha già una `<label className="sr-only">`
  corretta — incoerenza tra due componenti molto simili nello stesso
  repository).

**Disaccordi reali tra i revisori — non risolti a favore di uno a priori,
segnalati come tali:**

- **`<select>` nativo per l'ordinamento (punto 5/2):** io e Gemini lo
  vediamo come un'incoerenza visiva da sistemare; ChatGPT dissente
  esplicitamente — un `<select>` nativo è già accessibile e su iOS offre
  un'interazione più robusta di un componente custom, va sostituito solo
  se emerge un requisito funzionale reale, non per pura coerenza estetica.
  **Non lo marco più come "da fare" — resta in sospeso, da decidere con
  l'utente.**
- **`CountUp` riusato per il delta di prezzo su ogni tile (punto 13/5):**
  ChatGPT boccia la mia proposta — fino a 60 tile con `requestAnimationFrame`
  indipendenti in esecuzione simultanea a ogni caricamento pagina è un
  rischio di performance reale che non avevo considerato (io avevo
  segnato l'impatto performance come "basso", ChatGPT lo valuta "alto").
  **Rimuovo questo punto dal piano finale.**
- **Shimmer ambientale come alternativa al tilt-su-tap (punto 2):**
  Gemini lo aveva approvato come alternativa sicura al tilt-su-tap;
  ChatGPT è scettico anche su questo (consumo batteria, distrazione da
  animazione periodica) e preferirebbe un accento statico o una sola
  animazione per sessione. **Declassato da "soluzione consigliata" a
  "opzione tra altre, da validare con test reali prima di scegliere".**

**Valutazione delle 4 risorse esterne — ChatGPT corregge parzialmente la
mia:** conferma la cautela su canvasui.dev (HTML-in-canvas è dichiarato
sperimentale/origin-trial, non solo "va prototipato con giudizio" come
avevo scritto — un rischio di stabilità della piattaforma, non solo di
performance) e correttamente mi corregge su beautifului.dev: **avevo
scritto che il suo catalogo non mappa a nessun bisogno reale del
progetto — ChatGPT nota che esistono componenti Search/Filter
Table/Sidebar Nav/Records Table rilevanti come riferimento di pattern**
(non come dipendenza). Correzione accolta: non è "bassa rilevanza diretta"
quanto avevo scritto, va comunque consultato come riferimento per i
componenti filtri/ricerca già in scope in questo audit.

---

File/componenti principalmente coinvolti se questi punti venissero
implementati: `web/components/InteractiveCard.tsx`,
`web/components/CardTile.tsx`, `web/components/Toolbar.tsx`,
`web/components/FilterDropdown.tsx`, `web/components/FilterPresetControls.tsx`
(tooltip title=), `web/components/SiteHeader.tsx`,
`web/components/ConditionBadge.tsx` (icone, tooltip title=),
`web/components/PriceChart.tsx` (touch/keyboard),
`web/app/page.tsx`, `web/app/card/[id]/page.tsx`, `web/app/globals.css`,
`web/lib/db.ts` (limit/debounce/query, cache di Promise rifiutate).

Verificato con due revisioni indipendenti: Gemini (`ai_review.yml` run
#23, 2026-08-31 — log completo nel workflow "AI review" su questo branch)
e ChatGPT (PR #6, commento del 2026-08-31 15:13 UTC) — sezioni dedicate
sopra con correzioni accolte, un falso positivo scartato dopo verifica,
disaccordi tra revisori segnalati esplicitamente (non risolti a priori),
e più pattern reali aggiunti dopo verifica diretta sul codice.

---

## Piano finale ordinato per priorità (sintesi dei 3 giri di revisione)

Non implementato — resta un piano, in attesa di indicazioni dall'utente su
cosa affrontare e in che ordine. Le "difficoltà" sono stime, non misure.

### Livello 0 — bug concreti, non solo "UX migliorabile"

Questi non sono opinioni: sono comportamenti verificati leggendo il
codice riga per riga, con un impatto diretto su correttezza/performance,
non solo su "quanto è bello".

1. **`fetchCards()` senza `LIMIT` sulla home — scarica l'intero catalogo
   filtrato ad ogni ricerca/filtro, ne mostra 60.** (`web/lib/db.ts`,
   `web/app/page.tsx`). Il singolo intervento a rapporto valore/sforzo più
   alto di tutto l'audit.
2. **Nessun debounce sulla ricerca** — si somma direttamente al punto 1:
   ogni tasto rilancia la query senza LIMIT di cui sopra.
3. **`dbPromise`/`historyDbPromise` restano una Promise rifiutata per
   sempre dopo un solo fallimento di rete** (`web/lib/db.ts`,
   `getDb()`/`getHistoryDb()`) — un pulsante "Riprova" (vedi sotto) non
   serve a nulla finché questo non è risolto insieme.
4. **Messaggio d'errore caricamento DB scritto per sviluppatori, non
   utenti**, nessun retry funzionante (dipende dal punto 3).

### Livello 1 — accessibilità reale, non rifinitura

Trovati da ChatGPT, verificati da me sul codice attuale — non erano nel
mio giro originale, che aveva sovrappesato motion/animazioni e
sottopesato semantica/accessibilità (critica di ChatGPT accolta in pieno).

5. `CardTile.tsx`: bottoni stella/cuore annidati dentro il `<Link>` della
   card — HTML non valido, comportamento ambiguo per tastiera/screen
   reader.
6. `PriceChart.tsx`: nessuna interazione touch/keyboard — su mobile il
   grafico prezzi è di fatto statico (mostra solo l'ultimo punto).
7. `FilterDropdown.tsx`: il focus non torna al trigger chiudendo con ✕ o
   tap sul backdrop (solo Escape lo fa oggi) — incoerenza verificata.
8. Target di tocco incoerenti: 28px (stella/cuore in `CardTile.tsx`) contro
   il 44px usato sistematicamente altrove nello stesso progetto.
9. Ricerca principale (`Toolbar.tsx`) senza `aria-label`/label associata,
   a differenza della ricerca interna a `FilterDropdown` che ce l'ha già.

### Livello 2 — problemi confermati da entrambi i reviewer AI

10. Fallback per immagini che falliscono il caricamento (`onError`
    mancante ovunque) — attenzione a non creare un loop di retry.
11. Tooltip `title=` invisibili su touch (8 occorrenze in 5 file) — non
    trasformare ogni badge in popover touch (nota di ChatGPT accolta):
    rendere visibili di default i dati essenziali (lingua, condizione,
    paese), riservare i tooltip a dettagli davvero secondari.
12. `<select>` nativo per l'ordinamento — **disaccordo tra i due
    revisori, non deciso**: io/Gemini lo vediamo come incoerenza visiva
    da sistemare, ChatGPT dissente (nativo = già accessibile, robusto su
    iOS). Da chiedere all'utente prima di scegliere una direzione.
13. Buco breakpoint tablet (`md:grid-cols-4`) — validità confermata da
    Gemini, ChatGPT chiede di verificarlo empiricamente (768/820/912/1024px,
    nomi lunghi) prima di cambiare, non di assumerlo.
14. Chip rimovibili per i filtri attivi — valore alto confermato da
    entrambi; attenzione mobile (riga a scorrimento orizzontale o riepilogo
    collassabile, non crescita verticale illimitata).
15. Conteggio risultati vicino a ricerca/filtri — valido, con `aria-live`
    non aggressivo (non deve annunciare ad ogni carattere digitato).

### Livello 3 — rifiniture valide, priorità normale

16. Copia link/condividi vista filtrata (`navigator.share()` con fallback
    clipboard).
17. Indicatore leggero di refetch-in-corso (coordinato con debounce e
    cancellazione richieste in corso, non un reset completo dello stato).
18. Ridurre il peso visivo di "Inserzioni attive" rispetto al prezzo in
    pagina dettaglio.
19. Icone coerenti (SVG) al posto delle emoji miste.
20. Zoom/lightbox sull'immagine carta in pagina dettaglio (chiarire che
    mostra l'illustrazione, non lo stato fisico della copia posseduta).
21. Placeholder immagini più curato in caricamento, unificato con il
    fallback d'errore del punto 10.
22. Spazio verticale header sulla home — **non** un secondo hook
    hide-on-scroll indipendente da quello già live sulla toolbar
    (rischio di layout shift/collisioni segnalato da Gemini): prima
    compattazione responsive statica, poi eventualmente rivalutare.

### Livello 4 — da testare prima di decidere, non da assumere

23. Densità griglia 2 colonne su telefoni stretti (320-390px) con tutti i
    badge presenti insieme.
24. `2xl:grid-cols-6` su desktop molto larghi — preferenza di densità, non
    "spreco" oggettivo secondo ChatGPT.

### Livello 5 — congelati per ora (rischio > beneficio atteso)

25. **Hero WebGL (card grande in pagina dettaglio).** Il CSS attuale è già
    convincente; ChatGPT è più scettico di me — solo un eventuale spike
    con criteri di stop chiari (FPS/memoria/batteria), non un intervento
    pianificato.
26. **View Transitions API griglia→dettaglio.** Entrambi i reviewer
    concordano: rischio tecnico reale in Next.js App Router, non essenziale.
    Solo prototipo isolato con feature detection e test su browser reali,
    mai adozione diretta.
27. **Tilt-su-tap mobile.** Sconsigliato da Gemini (input lag percepito
    prima della navigazione). L'alternativa "shimmer ambientale" è a sua
    volta contestata da ChatGPT (batteria/distrazione) — nessuna delle due
    opzioni proposte ha convinto entrambi i reviewer: da ripensare da zero
    o lasciare l'asimmetria desktop/mobile com'è.
28. **`CountUp` su ogni tile della griglia.** Ritirato: rischio performance
    reale con decine di `requestAnimationFrame` simultanei, non l'ottimizzazione
    "quasi gratuita" che avevo stimato io.
29. Effetto olografico modulato per rarità — resta una richiesta di
    funzionalità legittima per un tracker da collezione, non la
    correzione di un difetto: fuori da un piano di "audit fix", eventuale
    iniziativa separata se l'utente la vuole.

### Task strutturale separato, priorità alta

- **Paginazione/count lato SQL per il catalogo intero** (non solo
  aggiungere un `LIMIT` alla home — richiede ripensare come contare i
  risultati totali e gestire "mostra altre N" con query incrementali
  invece che con un array JS già interamente in memoria). Segnalato da
  ChatGPT come intervento a parte, più ampio del semplice fix del punto 1
  del Livello 0 — il punto 1 è il fix minimo urgente, questo è la sua
  versione strutturale completa.
