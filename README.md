# CartaViva — CardTrader Tracker

Traccia prezzi, andamento e immagini delle tue carte Pokémon TCG (Illustration
Rare, Special Illustration Rare, full art, promo...) da CardTrader.

- **Dati**: script Python + GitHub Actions, gira gratis nel cloud, aggiorna i
  prezzi **ogni giorno automaticamente**, scrivendoli in un database Postgres
  gratuito (Neon/Vercel Postgres).
- **Sito**: Next.js, deploy gratuito su Vercel, interroga quel database
  server-side (nessun database scaricato nel browser).

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

## 2. Crea un database Postgres gratuito

Sync e sito condividono lo stesso database (catalogo, prezzi, login) — va
creato prima di lanciare qualunque sync, altrimenti gli script escono subito
con un errore ("POSTGRES_URL mancante").

1. Vai su **neon.tech** → Sign up (gratis, nessuna carta richiesta) → **New
   Project** (nome a piacere)
2. Nella dashboard del progetto, tab **Connect**, copia la connection string
   (inizia con `postgres://...`)
3. Nel repo GitHub → **Settings → Secrets and variables → Actions → New
   repository secret** → nome `POSTGRES_URL`, valore la stringa appena
   copiata

Non serve creare le tabelle a mano: il primo sync (punto 6) le crea da solo
al primo avvio.

Se in futuro pubblichi il sito su Vercel con l'integrazione "Vercel Postgres"
invece che con un account Neon separato, la connection string è la stessa
cosa: usa quella al posto di crearne una nuova, per non avere due database
scollegati.

## 3. Aggiungi il tuo token CardTrader come Secret

1. Sul tuo profilo CardTrader → Impostazioni → API, copia il token
2. Nel repo GitHub → **Settings → Secrets and variables → Actions → New
   repository secret**
3. Nome: `CARDTRADER_API_TOKEN` — Valore: il tuo token
4. Salva

Il token non finisce mai nel codice, resta cifrato da GitHub e visibile solo
ai workflow.

## 4. Trova i codici delle espansioni che ti interessano

1. Nel repo → tab **Actions** → workflow **"Elenca espansioni disponibili"**
   → **Run workflow**
2. Aspetta il completamento (circa 10-20 secondi), apri il log del job e
   troverai la lista di tutte le espansioni Pokémon con il relativo `code`

## 5. Configura le espansioni da tracciare

1. Nel repo, apri `config/tracked_sets.json`, clicca la matita (edit)
2. Sostituisci l'array `expansion_codes` con i codici che ti interessano,
   es.:
   ```json
   { "expansion_codes": ["sv8", "sv8pt5", "sv9"] }
   ```
3. Commit direttamente su `main`

Puoi tornare qui e aggiungere nuove espansioni ogni volta che vuoi.

## 6. Primo sync del catalogo (carte + immagini)

1. Tab **Actions** → workflow **"Sync catalogo (carte tracciate)"** → **Run
   workflow**
2. Aspetta il completamento: scarica tutte le carte delle espansioni scelte
   e le scrive nel database Postgres del punto 2 (crea le tabelle da solo al
   primo avvio)

## 7. Primo sync dei prezzi

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

Da qui in poi **non devi fare più nulla**: i workflow girano da soli e
aggiungono un nuovo punto storico per ogni carta direttamente nel database.
Se un sync lungo viene interrotto a metà, non perde il lavoro già fatto:
ogni carta viene scritta e confermata nel database una per una, quindi al
riavvio riparte semplicemente dalle carte non ancora aggiornate quel giorno.

## 8. Metti online il sito (Vercel, gratis)

1. Vai su vercel.com → **Sign up / Log in with GitHub** (autorizzi Vercel ad
   accedere ai tuoi repo — lo fai tu, con un click, io non ho mai accesso al
   tuo account)
2. **Add New → Project**, seleziona il repo privato appena creato
3. Alla voce **Root Directory** seleziona la cartella **`web`**
4. Framework Preset: Vercel riconosce automaticamente **Next.js**
5. **Settings → Environment Variables** → aggiungi `POSTGRES_URL` con la
   stessa connection string del punto 2 (Production, e opzionalmente
   Preview/Development)
6. Deploy

In 1-2 minuti ottieni un link tipo `https://ct-tracker.vercel.app` — apri
quello dal telefono o dal PC, niente da installare. Si ridispiega da solo
solo quando cambia il **codice** (un push su `main`): i sync di prezzi e
catalogo scrivono direttamente nel database e non toccano più il sito, quindi
i nuovi prezzi compaiono subito senza bisogno di un nuovo deploy.

## 9. Notifiche Telegram sui cali di prezzo (facoltativo, gratis)

Se vuoi ricevere un messaggio Telegram quando una carta scende di prezzo,
senza dover aprire il sito ogni giorno:

1. Su Telegram, cerca **@BotFather**, mandagli `/newbot` e segui le
   istruzioni (nome a piacere): alla fine ti dà un **token** tipo
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
2. Scrivi un messaggio qualsiasi al bot appena creato (altrimenti non può
   scriverti lui per primo)
3. Apri nel browser `https://api.telegram.org/bot<TOKEN>/getUpdates`
   (sostituisci `<TOKEN>` con il tuo) e cerca `"chat":{"id":` nel risultato:
   quel numero è il tuo **chat_id**
4. Nel repo → **Settings → Secrets and variables → Actions → New repository
   secret**, aggiungi due secret:
   - `TELEGRAM_BOT_TOKEN` — il token del punto 1
   - `TELEGRAM_CHAT_ID` — il chat_id del punto 3
5. Fatto: dal prossimo sync prezzi (giornaliero o settimanale) ricevi un
   messaggio ogni volta che c'è qualcosa da segnalare

Le notifiche hanno tre modalità indipendenti, tutte attive di default:

- **Soglia generale**: qualunque carta tracciata che scende di più del 15%
  rispetto al prezzo precedente (soglia regolabile con la variabile
  d'ambiente `DROP_THRESHOLD_PCT` nei workflow, se vuoi cambiarla)
- **Watchlist**: le carte che aggiungi tu in `config/watchlist.json` (l'id
  si trova nell'URL della pagina di dettaglio della carta sul sito, es.
  `/card/315075` → id `315075`), es.:
  ```json
  { "cards": [ { "id": 315075 }, { "id": 245522, "alert_below": 50 } ] }
  ```
  - senza `alert_below`: la carta viene sempre riportata col prezzo
    attuale ad ogni sync, anche senza un calo
  - con `alert_below` (un numero nella valuta della carta, di solito EUR):
    la carta viene riportata solo quando il prezzo scende a quel valore o
    sotto — utile per un obiettivo tipo "avvisami quando scende sotto i
    50€", senza essere notificato ogni giorno finché non ci arriva

Se non aggiungi i due secret, questo passaggio viene semplicemente saltato:
il resto del tracker continua a funzionare normalmente.

---

## Come funziona sotto il cofano

```
scripts/sync_catalog.py     → popola le tabelle catalogo su Postgres con
                               carte + immagini (URL immagine, non le
                               scarica in locale)
scripts/sync_prices.py      → ogni carta tracciata, interroga il marketplace
                               e salva uno snapshot di prezzo per la giornata
scripts/notify_telegram.py  → dopo il sync prezzi, manda un messaggio
                               Telegram se ci sono cali sopra soglia o carte
                               in watchlist (facoltativo, vedi punto 9)
web/                         → sito Next.js: le pagine interrogano il
                               database Postgres lato server (Route Handler
                               in web/app/api/**), il browser riceve solo
                               JSON già pronto
```

Tutto vive nello **stesso database Postgres** (`web/db/schema.sql`):

- tabella `blueprints` + `latest_prices` — catalogo carte e **solo l'ultimo
  prezzo noto** di ognuna: quello che la griglia principale, i filtri e la
  ricerca interrogano sempre
- tabella `price_snapshots` — lo **storico completo** giorno per giorno,
  interrogato solo quando apri il dettaglio di una carta (serve per il
  grafico), non per navigare il catalogo. Per restare compatto nel tempo, i
  dati più vecchi di 120 giorni vengono automaticamente compattati da
  giornalieri a settimanali (un punto a settimana invece di uno al giorno)

Il "trend" dei prezzi è costruito da noi nel tempo: CardTrader non offre uno
storico nativo, quindi ogni giorno aggiungiamo un punto. Più giorni passano,
più il grafico si popola.

## Aggiungere una nuova espansione in futuro

1. Trova il `code` (workflow "Elenca espansioni disponibili")
2. Aggiungilo a `expansion_codes` in `config/tracked_sets.json` (e anche a
   `daily_expansion_codes` se vuoi che i suoi prezzi si aggiornino ogni
   giorno invece che solo nel sync settimanale)
3. Il catalogo si popola da solo: modificare `config/tracked_sets.json` su
   `main` fa scattare automaticamente il workflow "Sync catalogo" in
   modalità "solo mancanti" (aggiunge solo le espansioni tracciate ma non
   ancora presenti, senza toccare quelle già sincronizzate). C'è anche un
   controllo automatico ogni giorno alle 04:30 UTC, utile per i set
   annunciati ma non ancora pubblicati su CardTrader al momento in cui li
   aggiungi. Per i prezzi resta comunque da lanciare a mano uno dei due
   workflow prezzi la prima volta (punto 7), o aspettare il prossimo giro
   schedulato.

## Sviluppo locale (facoltativo)

Se in futuro vuoi lavorarci dal tuo PC:

```bash
pip install -r requirements.txt
cp .env.example .env   # inserisci token e POSTGRES_URL, poi esportali nella shell
python scripts/sync_catalog.py
python scripts/sync_prices.py

cd web
cp .env.example .env.local   # POSTGRES_URL - stesso valore di sopra
npm install
npm run dev
```
