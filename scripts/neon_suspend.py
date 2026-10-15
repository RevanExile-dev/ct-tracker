"""
Spegne il compute Neon appena un sync ha finito, invece di aspettare i 5
minuti di inattivita' del piano gratuito.

Perche' (ore di calcolo, piano gratuito = 100 al mese): Neon spegne il
compute solo dopo 5 minuti senza attivita' e il timeout non e' modificabile.
Ogni sync (una volta ogni 30 minuti, piu' il catalogo notturno) lascia quindi
il database acceso ~5 minuti in piu' del necessario. Misurato il 15/10/2026:
~16,7 ore accese su 24 (4,2 ore di piano al giorno, proiezione ~95 su 100).
Con la sospensione esplicita si risparmiano ~10 minuti ogni ora.

Sicurezza:
  - serve il segreto NEON_API_KEY; senza, non fa nulla (come TELEGRAM_BOT_TOKEN);
  - sospende solo se nessun altro usa il database in quel momento (nessuna
    query attiva, nessuna attivita' negli ultimi RECENT_SECONDS): se il sito
    sta lavorando, il database si spegne da solo dopo i soliti 5 minuti;
  - qualunque errore (rete, API, database) viene solo stampato: non fa mai
    fallire il sync;
  - una connessione successiva risveglia il compute da sola (~1 s).
"""
import os
import time

import requests

import db

API_URL = "https://console.neon.tech/api/v2/projects/{project}/endpoints/{endpoint}/suspend"
# Identificatori (non segreti) del compute di produzione; sovrascrivibili.
DEFAULT_PROJECT_ID = "aged-truth-98501688"
DEFAULT_ENDPOINT_ID = "ep-morning-term-b10x2xgm"
# Dopo la chiusura della nostra connessione il pooler tiene ancora per qualche
# secondo una connessione "idle" appena cambiata di stato: si aspetta prima di
# controllare, cosi' non la si scambia per un altro utente.
SETTLE_SECONDS = 15
# Un'attivita' piu' recente di cosi' (di altri) impedisce la sospensione.
RECENT_SECONDS = 10
REQUEST_TIMEOUT_SECONDS = 15


def others_busy(conn, recent_seconds: int = RECENT_SECONDS) -> int:
    """Quante connessioni (diverse dalla nostra e da quelle di sistema Neon)
    stanno eseguendo qualcosa o hanno fatto qualcosa negli ultimi secondi."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT count(*) FROM pg_stat_activity
               WHERE datname = current_database()
                 AND pid <> pg_backend_pid()
                 AND usename <> 'cloud_admin'
                 AND (state IS DISTINCT FROM 'idle'
                      OR state_change > now() - make_interval(secs => %s))""",
            (recent_seconds,),
        )
        return cur.fetchone()[0]


def suspend_after_sync(
    settle_seconds: float = SETTLE_SECONDS,
    recent_seconds: int = RECENT_SECONDS,
    post=requests.post,
    sleep=time.sleep,
) -> str:
    """Da chiamare DOPO aver chiuso la connessione del sync. Non solleva mai."""
    api_key = os.environ.get("NEON_API_KEY")
    if not api_key:
        return "Sospensione Neon: disattivata (NEON_API_KEY non impostata)."
    try:
        sleep(settle_seconds)
        conn = db.get_connection()
        try:
            busy = others_busy(conn, recent_seconds)
        finally:
            conn.close()
        if busy:
            return f"Sospensione Neon: saltata, {busy} altre connessioni attive (si spegne da solo)."
        url = API_URL.format(
            project=os.environ.get("NEON_PROJECT_ID", DEFAULT_PROJECT_ID),
            endpoint=os.environ.get("NEON_ENDPOINT_ID", DEFAULT_ENDPOINT_ID),
        )
        response = post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code >= 300:
            return f"Sospensione Neon: risposta {response.status_code} dall'API (ignorata)."
        return "Sospensione Neon: richiesta inviata, il database si spegne ora."
    except (Exception, SystemExit) as exc:  # mai far fallire il sync per questo (db.get_connection esce se manca POSTGRES_URL)
        return f"Sospensione Neon: errore ignorato ({type(exc).__name__}: {exc})."
