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

File/componenti principalmente coinvolti se questi punti venissero
implementati: `web/components/InteractiveCard.tsx`,
`web/components/CardTile.tsx`, `web/components/Toolbar.tsx`,
`web/components/FilterDropdown.tsx`, `web/components/FilterPresetControls.tsx`
(tooltip title=), `web/components/SiteHeader.tsx`,
`web/components/ConditionBadge.tsx` (icone, tooltip title=),
`web/app/page.tsx`, `web/app/card/[id]/page.tsx`, `web/app/globals.css`,
`web/lib/db.ts` (debounce/query).

Verificato con revisione indipendente Gemini (`ai_review.yml` run #23,
2026-08-31 — log completo nel workflow "AI review" su questo branch):
sezione dedicata sopra ("Esito della seconda opinione") con correzioni
accolte, un falso positivo scartato dopo verifica, e due nuovi pattern
reali aggiunti alla lista (punti 25-26).
