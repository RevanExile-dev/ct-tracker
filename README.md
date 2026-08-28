# Binder — CardTrader Tracker

Traccia prezzi, andamento e immagini delle tue carte Pokémon TCG (Illustration
Rare, Special Illustration Rare, full art, promo...) da CardTrader.

- **Dati**: script Python + GitHub Actions, gira gratis nel cloud, aggiorna i
  prezzi **ogni giorno automaticamente**.
- **Sito**: Next.js, deploy gratuito su Vercel, legge il database
  direttamente nel browser (nessun server da mantenere).

Tutta la procedura qui sotto si fa **dal browser**, senza installare nulla sul
tuo PC.

---

## 1. Crea il repository

1. Vai su github.com → **New repository**
2. Nome a piacere (es. `ct-tracker`)
3. Visibilità: **Public** se vuoi che GitHub Actions resti gratuito e
   illimitato (consigliato se tracci molte espansioni: il sync prezzi
   completo può girare per ore). **Private** va bene solo se traccia poche
   carte, altrimenti su repo privati GitHub Actions è gratuito solo fino a
   una soglia di minuti al mese, oltre la quale si paga. Nessun dato
   sensibile finisce nel repo in nessuno dei due casi: il token CardTrader
   resta sempre cifrato come Secret.
4. Crealo vuoto (senza README, senza .gitignore)
4. Nella pagina del repo appena creato, clicca **"uploading an existing
   file"** (o Add file → Upload files) e trascina dentro **tutte** le
   cartelle e file di questo progetto così come te li ho consegnati
   (mantenendo la struttura: `.github/`, `scripts/`, `config/`, `data/`,
   `web/`, `requirements.txt`, ecc.)
5. Commit direttamente sul branch `main`

> Se il drag&drop di intere cartelle non funziona bene dal tuo browser, l'alternativa
> senza installare nulla è aprire **GitHub Codespaces** sul repo vuoto (tab
> "Code" → "Codespaces" → "Create codespace") — è un VS Code completo nel
> browser con terminale incluso, da lì puoi incollare i file e fare `git push`
> normalmente.

## 2. Aggiungi il tuo token CardTrader come Secret

1. Sul tuo profilo CardTrader → Impostazioni → API, copia il token
2. Nel repo GitHub → **Settings → Secrets and variables → Actions → New
   repository secret**
3. Nome: `CARDTRADER_API_TOKEN` — Valore: il tuo token
4. Salva

Il token non finisce mai nel codice, resta cifrato da GitHub e visibile solo
ai workflow.

## 3. Trova i codici delle espansioni che ti interessano

1. Nel repo → tab **Actions** → workflow **"Elenca espansioni disponibili"**
   → **Run workflow**
2. Aspetta il completamento (circa 10-20 secondi), apri il log del job e
   troverai la lista di tutte le espansioni Pokémon con il relativo `code`

## 4. Configura le espansioni da tracciare

1. Nel repo, apri `config/tracked_sets.json`, clicca la matita (edit)
2. Sostituisci l'array `expansion_codes` con i codici che ti interessano,
   es.:
   ```json
   { "expansion_codes": ["sv8", "sv8pt5", "sv9"] }
   ```
3. Commit direttamente su `main`

Puoi tornare qui e aggiungere nuove espansioni ogni volta che vuoi.

## 5. Primo sync del catalogo (carte + immagini)

1. Tab **Actions** → workflow **"Sync catalogo (carte tracciate)"** → **Run
   workflow**
2. Aspetta il completamento: scarica tutte le carte delle espansioni scelte
   e aggiorna `data/cardtrader.db`

## 6. Primo sync dei prezzi

Ci sono **due workflow prezzi distinti**, perché con molte espansioni
tracciate un sync completo può richiedere diverse ore (l'API marketplace è
limitata a 1 richiesta/secondo):

- **"Sync prezzi CardTrader"**: gira da solo ogni giorno alle 06:00 UTC,
  aggiorna solo le espansioni recenti elencate in `daily_expansion_codes`
  dentro `config/tracked_sets.json` (di default: era Scarlet & Violet +
  Mega Evolution)
- **"Sync prezzi CardTrader (completo, settimanale)"**: gira da sola ogni
  domenica alle 02:00 UTC, aggiorna **tutte** le carte in
  `expansion_codes` (può durare ore)

Lancia entrambi manualmente la prima volta (tab **Actions** → workflow →
**Run workflow**) per avere subito dei dati, invece di aspettare il prossimo
giro schedulato.

Da qui in poi **non devi fare più nulla**: i workflow girano da soli,
aggiungono un nuovo punto storico per ogni carta e aggiornano il sito. Se un
sync lungo viene interrotto a metà, non perde il lavoro già fatto: salva e
pusha un checkpoint ogni ~300 carte.

## 7. Metti online il sito (Vercel, gratis)

1. Vai su vercel.com → **Sign up / Log in with GitHub** (autorizzi Vercel ad
   accedere ai tuoi repo — lo fai tu, con un click, io non ho mai accesso al
   tuo account)
2. **Add New → Project**, seleziona il repo privato appena creato
3. Alla voce **Root Directory** seleziona la cartella **`web`**
4. Framework Preset: Vercel riconosce automaticamente **Next.js**
5. Deploy

In 1-2 minuti ottieni un link tipo `https://ct-tracker.vercel.app` — apri
quello dal telefono o dal PC, niente da installare, e si aggiorna da solo ad
ogni push (quindi anche dopo ogni sync prezzi giornaliero).

---

## Come funziona sotto il cofano

```
scripts/sync_catalog.py   → popola data/cardtrader.db con carte + immagini
                             (URL immagine, non le scarica in locale)
scripts/sync_prices.py    → ogni carta tracciata, interroga il marketplace
                             e salva uno snapshot di prezzo per la giornata
web/                       → sito Next.js che legge data/cardtrader.db
                             DIRETTAMENTE nel browser (sql.js/WASM),
                             nessun backend da mantenere
```

Il "trend" dei prezzi è costruito da noi nel tempo: CardTrader non offre uno
storico nativo, quindi ogni giorno aggiungiamo un punto. Più giorni passano,
più il grafico si popola.

## Aggiungere una nuova espansione in futuro

1. Trova il `code` (workflow "Elenca espansioni disponibili")
2. Aggiungilo a `expansion_codes` in `config/tracked_sets.json` (e anche a
   `daily_expansion_codes` se vuoi che i suoi prezzi si aggiornino ogni
   giorno invece che solo nel sync settimanale)
3. Lancia manualmente "Sync catalogo" e poi uno dei due workflow prezzi

## Sviluppo locale (facoltativo)

Se in futuro vuoi lavorarci dal tuo PC:

```bash
pip install -r requirements.txt
cp .env.example .env   # inserisci il tuo token
python scripts/sync_catalog.py
python scripts/sync_prices.py

cd web
npm install
npm run dev
```
