# Carta Viva — piano UX/UI, Binder, motion e QA

Ultimo aggiornamento: 2026-08-30

> **Nota (2026-08-31): documento storico.** Registra il lavoro di
> revamp UI/prezzi di quella sessione (Codex + verifica Claude) — molte
> caselle rimaste `[ ]` qui sotto sono state completate in sessioni
> successive (review multi-AI, regression pass, ecc.), quindi lo stato di
> spunta NON riflette più la realtà attuale. Per lo stato corrente vedi la
> issue GitHub #1 ("Stato progetto e prossimi passi"). Lasciato invariato
> come registro di cosa è stato fatto quella notte, non da aggiornare
> retroattivamente.

## Obiettivo e principi

Portare Carta Viva da prototipo funzionale a prodotto coerente e rifinito,
seguendo quest'ordine di priorita': affidabilita', UX, responsive,
interazione, motion, estetica. Ogni voce viene marcata completata solo dopo
implementazione e verifica; le verifiche non eseguibili restano esplicitamente
aperte.

## Audit iniziale

- La home persiste gia' gran parte dei filtri nella query string, ma non
  conserva numero di carte caricate/scroll e lo stato locale non reagisce a
  navigazioni history successive.
- `/movers` mantiene filtri solo in `useState`: tornando dal dettaglio si
  perdono. Non ha espansione, ricerca, ordinamento o preset.
- `FilterDropdown` e' un popover `absolute`: evita di spingere il contenuto ma
  puo' sovrapporsi alle card e richiede calcoli di placement. La stessa
  implementazione e' condivisa da home, movers e dettaglio.
- Esistono due esperienze Binder: filtro `Il mio binder` nella home e route
  `/binder-book`. Hanno nomi quasi identici ma architettura separata.
- Il libro e' gia' un buon prototipo 3D, ma e' limitato a 760 px, mostra sempre
  una doppia pagina, avanza di una singola facciata, non supporta swipe/tastiera
  e su telefono si limita a rimpicciolirsi.
- `HoloFrame` offre tilt mouse e touch, ma scrive gli style a ogni evento senza
  `requestAnimationFrame`, usa `touch-action: none` su tutta la carta e non ha
  semantica/focus propria. Va evoluto in un `InteractiveCard` riutilizzabile con
  livelli `detail`, `binder` e `tile`.
- Branding attuale: wordmark testuale a gradiente e metadata minimi. Mancano
  marchio compatto, favicon/app icon, OpenGraph e `theme-color`.
- Motion esistente: aurora, ingresso card, skeleton, grafico, pop e flip. Va
  unificato tramite token di durata/easing e completato con focus/reduced motion.

## Decisioni architetturali

1. **Filtri inline**: sostituire il popover flottante con un pannello espandibile
   nel flusso, animato tramite una griglia `0fr -> 1fr`. Un gruppo coordina i
   pannelli per mantenere aperto un filtro alla volta e ridurre l'altezza.
2. **Stato navigabile**: query parameters come fonte condivisibile per filtri,
   ordinamento, ricerca, vista e pagina; `sessionStorage` solo per scroll e
   contesto effimero. `localStorage` per il preset personale.
3. **Binder unico**: `/binder` diventa l'hub con controllo segmentato
   `Collezione | Sfoglia`; `/binder-book` resta come redirect compatibile.
4. **Libro responsive**: doppia pagina su desktop/tablet landscape, pagina
   singola su viewport strette; navigazione a facciate coerente, swipe con soglia,
   tastiera e controlli accessibili.
5. **Motion a livelli**: `InteractiveCard` completo nel dettaglio, leggero nel
   Binder, micro-feedback nella griglia. Aggiornamenti pointer raggruppati in
   `requestAnimationFrame`; solo transform/opacity e nessun listener globale per
   carta.
6. **Brand vettoriale**: simbolo SVG originale (carta inclinata + scintilla/onda
   luminosa) e wordmark HTML/CSS, riusabile in header, favicon e social preview.

## Rischi e dipendenze

- Next.js 16/React 19: mantenere componenti client solo dove serve e non
  introdurre librerie motion pesanti.
- Il DB viene caricato nel browser: evitare remount o query duplicate durante
  la sincronizzazione URL/stato.
- Gesture del libro e tilt non devono catturare lo scroll verticale; usare
  Pointer Events e `touch-action` mirato.
- Le animazioni 3D possono creare overflow/z-index: testare contenitore, pagine
  in flip e resize durante/alla fine della transizione.
- Prima di ogni push verificare che nessun workflow di sync prezzi sia attivo.
- Il workflow AI vede solo ref disponibili su GitHub: le review del diff
  richiedono commit/push intermedi o un branch remoto.

## Macrofasi

### Fase 1 — Stato e filtri

- Creare modello serializzabile condiviso per query/preset.
- Rifattorizzare i filtri come pannelli inline accessibili.
- Portare persistenza completa su home e movers.
- Aggiungere preset locale con applica/salva/sovrascrivi/elimina.

### Fase 2 — Binder

- Creare hub Binder e nomenclatura unica.
- Rendere la collezione una vista dedicata e il libro immersivo/responsive.
- Aggiungere swipe, tastiera, stato pagina e ritorno dal dettaglio.

### Fase 3 — Carte e motion

- Introdurre `InteractiveCard` con profili di intensita'.
- Integrare dettaglio, Binder e tile.
- Consolidare motion token, focus e reduced motion.

### Fase 4 — Brand e shell

- Logo completo/compatto animabile.
- Header/navigation coerenti.
- Favicon, icone, metadata, OpenGraph e theme color.

### Fase 5 — QA e review

- Lint, build/typecheck e controlli statici.
- Browser QA su viewport, input e flussi back.
- Review Groq di routine e review finale `auto` (Gemini con fallback Groq).
- Correzioni, regression pass, aggiornamento checklist e report.

## Checklist verificabile

### Analisi e filtri

- [x] analisi UI attuale
- [x] redesign filtri Carte in movimento
- [x] filtri inline / soluzione equivalente elegante
- [x] animazioni filtri
- [x] accessibilita' filtri (ARIA, focus, tastiera)
- [x] persistenza filtri dopo back
- [x] persistenza espansione/set
- [x] persistenza ordinamento
- [x] persistenza ricerca
- [x] persistenza paginazione/quantita' visibile
- [x] preservazione stato utile pagina
- [x] ripristino scroll utile
- [x] preset personale filtri
- [x] salva preset
- [x] modifica/sovrascrivi preset
- [x] reset/elimina preset
- [x] pulsante Applica il mio filtro

### Binder

- [x] analisi dei due Binder attuali
- [x] unificazione UX Binder
- [x] nomenclatura Binder chiara
- [x] vista collezione
- [x] vista sfoglia Binder
- [x] Binder piu' grande
- [x] modalita' libro desktop
- [x] modalita' libro tablet
- [x] modalita' libro smartphone
- [x] doppia pagina
- [x] pagina singola responsive
- [x] page turn animation
- [x] swipe touch
- [x] navigazione pagine PC
- [x] navigazione tastiera
- [x] indicatore pagina comprensibile
- [x] apertura dettaglio dal Binder
- [x] ritorno dal dettaglio alla facciata corretta
- [x] gesture carta/pagina non ambigue

### Carte e motion

- [x] InteractiveCard component
- [x] tilt mouse
- [x] touch/drag
- [x] perspective/parallax
- [x] holo/light effect
- [x] shadow/depth effect
- [x] neutral reset animation
- [x] Binder card micro-animation
- [x] griglie con micro-feedback leggero
- [x] requestAnimationFrame / listener review
- [x] animazioni sospese quando non rilevanti
- [x] prefers-reduced-motion
- [x] motion design generale
- [x] motion consistency
- [x] focus-visible coerente

### Branding e browser

- [x] Carta Viva branding
- [x] logo principale
- [x] logo compatto
- [x] logo animation
- [x] favicon
- [x] app icon
- [x] metadata
- [x] browser title
- [x] theme-color
- [x] OpenGraph/social preview

### Navigazione e responsive QA

- [ ] back navigation lista -> dettaglio -> back
- [ ] back navigation movers -> dettaglio -> back
- [ ] back navigation Binder -> carta -> back
- [ ] back navigation libro -> carta -> back
- [ ] QA 360px
- [ ] QA 390px
- [ ] QA 412-430px
- [ ] tablet portrait QA
- [ ] tablet landscape QA
- [ ] desktop 1366 QA
- [ ] desktop 1440 QA
- [ ] desktop 1920 QA
- [ ] intervalli intermedi QA
- [ ] portrait/landscape QA
- [ ] mouse QA
- [ ] touch QA
- [ ] keyboard QA
- [ ] resize QA
- [ ] overflow QA
- [ ] loading/error/empty/data states QA
- [ ] header/logo/navbar QA
- [ ] toolbar/pannelli/controlli QA
- [ ] griglie/detail/Binder QA

### Verifica finale

- [x] performance review statica
- [ ] console error review
- [x] build
- [x] lint/type-check
- [ ] multi-AI review di routine (Groq)
- [ ] multi-AI review finale (auto/Gemini)
- [ ] correzioni post-review
- [ ] regression pass finale
- [ ] controllo workflow sync prima del push
- [ ] documentazione finale e stato working tree pulito

## Registro verifiche e limiti

Da aggiornare durante ogni macrofase con comando/viewport, esito e problemi
riscontrati. Le caselle QA restano aperte finche' non esiste una verifica
effettiva riproducibile.

### Registro 2026-08-30 — implementazione Codex

- Commit locale principale: `aeeed56` (`Overhaul Carta Viva UX, Binder e
  motion`). Il presente aggiornamento del piano viene registrato in un commit
  di handoff separato.
- `npm run lint`: superato senza errori o warning.
- `npm run build`: superato; include compilazione, type-check e prerender delle
  9 route (`/`, `/movers`, `/binder`, redirect legacy, dettaglio, icona,
  manifest e OpenGraph).
- `git diff --check`: superato.
- Il browser cloud non puo' raggiungere il server `localhost` della sessione
  (`ERR_BLOCKED_BY_CLIENT`), quindi le caselle di QA visivo/input restano aperte
  finche' la build non e' pubblicata su Vercel.
- Push HTTPS locale bloccato per assenza di credenziali; connessione GitHub API
  disponibile solo in lettura (`403 Resource not accessible by integration` su
  Git Trees). Di conseguenza non e' ancora possibile pubblicare il commit.
- Il workflow AI esistente non puo' vedere un commit non pubblicato e non e'
  disponibile un'azione `workflow_dispatch` nella connessione corrente:
  review Groq/Gemini correttamente lasciate aperte.
- Prima del tentativo di push, GitHub riportava `0` workflow in corso. Ripetere
  obbligatoriamente il controllo immediatamente prima del prossimo push.
