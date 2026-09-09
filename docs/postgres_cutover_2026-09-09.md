# Cutover a Postgres — nota di quanto fatto e come rifarlo

Il 9 settembre 2026 è stato completato il travaso dei dati reali (fase 2 del
piano descritto nel corpo della PR #29) dal Postgres su cui vive schema e
dati di CartaViva. Questa nota registra cosa è stato fatto e, soprattutto,
gli intoppi reali incontrati usando **GitHub Codespaces** come ambiente
"usa e getta" per un'operazione una tantum senza installare nulla in
locale — utile la prossima volta che serve rifare qualcosa di simile
(es. dopo un reset del database, o su un ambiente diverso da questo).

## Cosa è stato ottenuto

- **Schema applicato** (`web/db/schema.sql`) sul Postgres di produzione
  (Neon, progetto `neon-teal-lighthouse-ct-tracker`, collegato al progetto
  Vercel `ct-tracker`): 13 tabelle create (Auth.js + applicative + catalogo/
  prezzi). Fatto dalla console SQL di Neon (non dal tab "Query" di Vercel,
  vedi sotto perché).
- **Dati reali migrati** (`scripts/migrate_to_postgres.py`, dry-run poi
  esecuzione vera), verificati **due volte** in modo indipendente — sia dal
  confronto conteggi automatico dello script, sia con una query diretta
  lanciata da Claude via MCP Neon — combacianti su tutte le tabelle:

  | tabella | righe |
  |---|---|
  | expansions | 224 |
  | blueprints | 29.315 |
  | latest_prices | 29.315 |
  | price_listings | 512.211 |
  | meta | 2 |
  | price_snapshots | 158.175 |

- Restano da fare (fuori dalla portata di questa nota, vedi PR #29): secret
  `POSTGRES_URL` su GitHub Actions, verifica della stessa variabile su
  Vercel, merge della PR.

## Come rifarlo: GitHub Codespaces, senza installare nulla in locale

Utile se chi deve eseguire l'operazione non ha (o non vuole usare) un
terminale sul proprio computer. Passi generali:

1. Sul repo GitHub, cambia branch nel selettore in alto a sinistra scegliendo
   quello con lo script che serve (per la migrazione dati:
   `claude/sqlite-postgres-migration-2hr90p`, o quello che lo sostituirà
   dopo il merge).
2. **Code → Codespaces → "Create codespace on `<branch>`"**. Si apre un VS
   Code completo nel browser con un terminale.
3. Se lo script ha bisogno di file che esistono solo su un altro branch
   (qui: `data/cardtrader.db` e `data/price_history.db`, rimossi da questo
   branch ma ancora presenti su `main`):
   ```bash
   git fetch origin main
   git checkout origin/main -- data/cardtrader.db data/price_history.db
   ```
   **Attenzione**: questo comando non solo scarica i file, li **mette anche
   in stage per il commit** (git li vede come "nuovi file" da committare,
   anche se poi li cancelli a mano dal disco). A fine lavoro, prima di
   cancellarli, va anche tolto lo stage:
   ```bash
   git reset HEAD -- data/cardtrader.db data/price_history.db
   rm -f data/cardtrader.db data/price_history.db
   ```
   (`git status` deve tornare pulito — controllarlo sempre, non fidarsi a
   memoria).

## Installazione dipendenze Python: cosa è andato storto

`pip install -r requirements.txt` per intero **ha fallito**, ma non per lo
script che serviva a noi:

- **Pillow** (11.0.0) non ha una wheel precompilata per la versione di
  Python 3.14 che gira di default nell'immagine Codespaces usata quel
  giorno, e il build da sorgente fallisce (manca `libjpeg` di sistema).
  Pillow serve solo a `scripts/scanner_m1_spike.py` (spike non collegato
  alla migrazione) — **non necessario** per `migrate_to_postgres.py`.
- **Comportamento di pip da ricordare**: se anche un solo pacchetto del
  gruppo fallisce la build, pip **non installa NESSUNO** degli altri, pure
  quelli già compilati con successo (qui `psycopg2-binary` era pronto ma
  non è stato installato per questo).

**Soluzione usata**: installare solo il pacchetto che serve davvero,
saltando `requirements.txt` per intero:
```bash
pip install psycopg2-binary==2.9.9
```
Poi però **secondo problema**: `psycopg2-binary==2.9.9` (2023) non è
compatibile con Python 3.14 (`ImportError: undefined symbol:
_PyInterpreterState_Get` - un simbolo interno di CPython cambiato tra
versioni). Va presa una versione più recente, non quella fissata in
`requirements.txt` (per un'esecuzione una tantum in un ambiente usa-e-getta
non serve rispettare quel pin, che esiste per la riproducibilità di CI):
```bash
pip install --upgrade --force-reinstall psycopg2-binary
```
**Prossima volta**: partire direttamente con questi due comandi (skip di
`requirements.txt`) invece di scoprire il problema per tentativi.

## Connection string: copiarla in modo affidabile

Incollare la connection string **direttamente** nel comando
`export POSTGRES_URL="..."` nel terminale del browser si è troncato di 2
caratteri alla fine (`sslmode=requi` invece di `sslmode=require`) — causa
non identificata con certezza (probabile limite del copia-incolla del
terminale integrato), ma il sintomo è chiaro: `psycopg2.OperationalError:
invalid sslmode value`.

**Soluzione più affidabile**: incollarla in un file (dove si vede per
intero e si può controllare a occhio), poi caricarla da lì invece di
ridigitarla:
```bash
# incollare la stringa in un file .env (dall'editor VS Code, non da riga di comando)
export POSTGRES_URL=$(cat .env)
echo "${#POSTGRES_URL}"   # controllo di sanità: confrontare la lunghezza attesa
rm .env                    # a fine lavoro, non lasciarla su disco
```

**Nota di sicurezza**: la connection string contiene la password vera del
database. Va incollata SOLO nel terminale/editor del proprio ambiente,
MAI in una chat con un assistente AI (è successo per errore in questa
sessione) — se capita, conviene rigenerare la password su Neon/Vercel
subito dopo (Neon → Settings → Roles → Reset password), non è un dramma ma
è buona igiene non lasciarla circolare oltre il necessario.

## Riepilogo: cosa installare / non installare la prossima volta

| Cosa | Serve per la migrazione? | Nota |
|---|---|---|
| `psycopg2-binary` (ultima versione, non 2.9.9) | Sì, unico pacchetto necessario | `pip install --upgrade psycopg2-binary` |
| `Pillow` | No | Salta, rompe la build su Python 3.14 in Codespaces |
| `requests` | No | Serve solo per parlare con l'API CardTrader, non per la migrazione dati |
| `requirements.txt` intero | No | Fallisce per colpa di Pillow, inutile installarlo tutto per questo task |
