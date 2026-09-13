# Formato Markdown per l'import lotti (`/lotti`) - metodo definitivo

Nato da una richiesta esplicita dell'utente: simulare un import reale contro
il catalogo Postgres, vedere cosa il matching NON riconosce, e definire una
volta per tutte come deve essere scritta una tabella Markdown perche' venga
riconosciuta senza intervento manuale. Non teoria: ogni riga sotto e'
verificata sul database reale di CartaViva (Neon `neon-teal-lighthouse-ct-tracker`),
non su un catalogo finto.

## Metodo di verifica usato

1. Preso un elenco reale di 78 carte fornito dall'utente in formato
   `/lotti` (Carta | Set | Tipo | Prezzo pagato | Data).
2. Fatto girare `parseLotImportMarkdown` (web/lib/lotImport.ts) verbatim
   (nessuna riscrittura) su quel testo: 78/78 righe parsate senza warning.
3. Riprodotta ESATTAMENTE la logica di matching di `matchRow`
   (web/lib/lotImport.server.ts) in SQL contro `blueprints` via query dirette
   al Postgres del progetto (stesso identico algoritmo: match esatto sul
   nome, poi narrowing sul Set con substring bidirezionale case-insensitive,
   poi narrowing sul Tipo dichiarato tramite `narrowByDeclaredType`).
4. Per ogni riga rimasta ambigua/non risolta, letti i candidati REALI dal
   catalogo (nome, set, rarita') per capire la causa esatta, non supposta.

Risultato: **66/78 righe (85%) risolte automaticamente al primo giro**, 12
no. Due cause erano bug veri e circoscritti nel matcher (corretti in questo
stesso giro, vedi sotto: ora **67/78**); le rimanenti 11 sono o errori nei
dati sorgente o limiti strutturali del catalogo che nessuna riscrittura del
Markdown puo' aggirare - vanno solo conosciuti.

## Le 3 regole che garantiscono il riconoscimento automatico

**1. Carta: il nome INGLESE esatto della carta, senza aggiungere suffissi
("ex", "V", "VSTAR"...) che la stampa non ha davvero.**
Verificato reale (riga 71 del campione): "Kingdra ex" in "Astral Radiance"
non esiste - in quell'espansione (era Sword & Shield, 2022, precedente al
ritorno del suffisso "ex" in Scarlet & Violet) la carta tracciata e'
"Kingdra" (senza "ex"), Illustration Rare, Trainer Gallery. Il Markdown
sorgente aveva un refuso/nome inventato dall'assistente che l'ha generato,
non un problema di matching: nessuna riscrittura del Set l'avrebbe risolto,
serve correggere il NOME. Prima di scrivere "X ex"/"X V"/"X VSTAR" perche'
"e' la carta rara", controllare che quella specifica stampa abbia
davvero quel suffisso nel nome.

**2. Set: il nome INGLESE ufficiale dell'espansione, cosi' come lo conosce
il catalogo - va benissimo aggiungere testo extra tra parentesi o un
numero carta dopo il nome, viene ignorato senza danno.**
Il confronto e' un substring bidirezionale case-insensitive
(`expansion_name.includes(set) || set.includes(expansion_name)`), quindi
tutte queste varianti hanno funzionato SENZA problemi nel campione reale:
- `SV Black Star Promos (SVP052)` → trovato `SV Black Star Promos`
- `Crown Zenith (Galarian Gallery)` → trovato `Crown Zenith`
- `Obsidian Flames #208` → trovato `Obsidian Flames`
- `Paldea Evolved #268/193` → trovato `Paldea Evolved`

Attenzione pero': il numero dopo il set (`#208`, `#268/193`, `SVP159`) NON
viene usato per disambiguare - il catalogo (tabella `blueprints`) non ha
NESSUNA colonna per il numero di carta/collector number. E' testo innocuo,
non un aiuto reale al matching (vedi regola 4).

**3. Tipo: solo QUATTRO abbreviazioni sono davvero riconosciute -
tutto il resto viene ignorato in silenzio, non genera un errore ma nemmeno
restringe nulla.**

| Scrivi   | Rarita' cercata            |
|----------|------------------------------|
| `IR`     | Illustration Rare             |
| `SIR`    | Special Illustration Rare     |
| `Promo`  | Promo                          |
| `IR TG`  | Illustration Rare (le stampe Trainer Gallery in questo catalogo condividono la stessa rarita' "Illustration Rare" del set principale, non una loro rarita' distinta) |

`IR TG` **non era riconosciuto prima di questa verifica** (riga 25 del
campione, "Hoothoot" in "Astral Radiance": restava ambiguo tra la Common e
la Illustration Rare dello stesso set) - aggiunto a
`TYPE_ABBREVIATION_HINTS` in web/lib/lotImport.ts in questo stesso giro.

Qualunque altro valore - `V`, `VMAX`, `VSTAR`, `Trainer`, `Promo/Cosmos
Holo`, o il nome completo di una rarita' come `Ultra Rare`/`Secret Rare` -
**non fa assolutamente nulla**: non e' un bug da aggirare scrivendo
qualcos'altro, e' cosi' che il codice e' scritto oggi (vedi
`TYPE_ABBREVIATION_HINTS`, solo 4 chiavi). Se la carta ha piu' stampe nello
stesso set con rarita' diverse e nessuna delle 4 abbreviazioni sopra
corrisponde alla stampa che hai davvero, la riga finira' comunque tra le
"ambigue" - normale, va scelta a mano dalla UI di risoluzione (che mostra
l'immagine di ogni candidato).

Verificato anche un problema latente collegato, per fortuna non innescato
da nessuna delle 78 righe del campione ma reale nel catalogo: alcuni set
salvano "Special Illustration Rare" come `Special Illustration` (Dark
Phantasma) o `Special Illustraion Rare` - refuso, Fusion Strike - invece
della forma canonica (vedi `RARITY_ALIASES` in web/lib/rarity.ts). Prima di
questo giro, `narrowByDeclaredType` confrontava la rarita' letterale senza
passare da `normalizeRarity`: un "SIR" su una carta di quei due set non
avrebbe MAI trovato corrispondenza. Corretto nello stesso commit.

## Cosa NON si puo' risolvere scrivendo il Markdown in un altro modo

Questi casi vanno accettati come risoluzione manuale via UI (l'ambiguous
mostra le immagini dei candidati, non e' un vicolo cieco) - non sono un
problema di formato:

- **Piu' stampe della stessa carta, stesso set, stessa rarita' dichiarata**
  (es. righe 75/76 del campione, "Magneton"/"Eevee" in "SV Black Star
  Promos": piu' numeri promo diversi, tutti rarita' "Promo") - il catalogo
  non ha un campo numero-carta, quindi nessuna abbreviazione di Tipo puo'
  scendere sotto quel livello. Va scelta l'immagine giusta a mano.
- **Duplicato reale nel catalogo**: `Black Bolt` (`blk`, 172 carte) e
  `Black Bolt | sv11B` (`sv11b`, 174 carte) sono DUE espansioni tracciate
  separatamente per (a quanto pare) lo stesso set inglese - stesso
  fenomeno per `White Flare`/`White Flare | sv11W`. Verificato query diretta:
  stesse carte, stessa rarita', id e image_url diversi - non varianti reali,
  proprio un doppione di ingestion. Righe 36/37/52/66/67 del campione
  (Pansage, Swanna, Larvesta, Axew, Mienshao) cadono tutte in ambiguo per
  questo, indipendentemente da come si scrive il Set. Da sistemare lato
  catalogo/config (`config/tracked_sets.json`, `scripts/sync_catalog.py`),
  NON e' un problema del parser - fuori scope per questo giro (tocca dati
  di sync/prezzi gia' scritti, non solo l'import lotti: da investigare a
  parte prima di rimuovere un codice tracciato).
- **`151` (EN, `mew`, 208 carte) vs `Pokémon Card 151` (JP, `sv2a`, 210
  carte)**: queste sono legittimamente DUE edizioni linguistiche diverse
  della stessa carta, entrambe tracciate - scrivere solo `151` come Set le
  matcha entrambe (substring bidirezionale). Riga 70 del campione
  ("Psyduck"): va specificato che carta si intende, o scelta a mano.

## Correzioni suggerite alle 3 righe con un errore nei dati sorgente

Non problemi di formato: la tabella andrebbe corretta a monte (da chi la
genera, es. un altro assistente AI) prima di reimportarla.

| Riga | Scritto | Correzione suggerita | Perche' |
|------|---------|----------------------|---------|
| 71 | `Kingdra ex` / `Astral Radiance` / `IR TG` | `Kingdra` (senza "ex") | verificato sul catalogo: l'unica "Kingdra" in Astral Radiance e' Illustration Rare, "Kingdra ex" non esiste in quel set |
| 74 | `Grusha` / `Paldea Evolved #268/193` / `Trainer` | `SIR` (o `Uncommon`/`Ultra Rare` a seconda della stampa realmente posseduta) | "Trainer" e' il supertipo della carta (Supporter), non una rarita' - non restringe nulla; il numero `#268/193` e' molto alto per un set da 193 carte base, tipico delle secret/special illustration rare |
| 77 | `Pidgeotto` / `Obsidian Flames #208` / `IR` | `SIR` | il catalogo non ha nessuna stampa "Illustration Rare" di Pidgeotto in Obsidian Flames, solo Special Illustration Rare e Uncommon - il numero `#208` (oltre le 197 carte base) e' coerente con la SIR, non con una normale IR |

## Riepilogo per chi genera queste tabelle (Claude, ChatGPT, Gemini, ...)

Prompt/istruzione riassuntiva da dare a un assistente che prepara una
tabella per `/lotti`:

> Scrivi il nome della carta in inglese esattamente come stampato (aggiungi
> "ex"/"V"/"VSTAR" solo se la stampa che intendi ce l'ha davvero nel nome).
> Scrivi il set in inglese come lo chiama il gioco (va bene aggiungere altro
> testo dopo, viene ignorato). Nella colonna Tipo scrivi SOLO una di: IR,
> SIR, Promo, IR TG - corrispondente alla rarita' REALE della stampa che
> hai (non il supertipo della carta come "Trainer", non VMAX/VSTAR/V che
> sono il meccanismo di gioco). Se non sei sicuro della rarita' esatta,
> lascia la colonna vuota piuttosto che scrivere qualcosa di sbagliato: una
> riga con Tipo vuoto puo' finire tra le ambigue e si risolve a mano con
> l'immagine, mentre un Tipo sbagliato (es. IR quando la stampa e' SIR) non
> aiuta e puo' confondere la scelta finale.
