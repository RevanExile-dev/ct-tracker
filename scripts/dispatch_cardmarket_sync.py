"""
Avvia il sync dei prezzi Cardmarket (sync_cardmarket_prices.yml) dai giri
frequenti delle carte tracciate, di notte (ora di Roma), se non e' gia' partito.

Perche': come per il catalogo (vedi dispatch_night_catalog.py) GitHub ritarda o
salta i cron, anche per un giorno intero; i giri delle tracciate invece sono
puntuali ogni 30 minuti perche' li lancia il ping esterno di cron-job.org, e
fanno da "orologio". Il cron del workflow Cardmarket resta (se parte, bene) ma
non e' piu' l'unica via.

Regole (tutte devono valere per avviare un giro):
  - ora di Roma tra le 01:30 e le 07:00 (TCGdex rinnova i prezzi verso le
    22:54 UTC, cioe' dopo mezzanotte in ora di Roma);
  - nessun giro Cardmarket gia' in coda o in corso;
  - nessun giro riuscito nelle ultime LOOKBACK_HOURS ore;
  - meno di MAX_FAILED giri falliti nelle ultime LOOKBACK_HOURS ore (se la
    fonte e' giu' non si martella: il giorno dopo si riprova).
Cancellati e saltati non contano.

Uso (nel workflow, con GH_TOKEN e permesso actions: write):
  python scripts/dispatch_cardmarket_sync.py
"""
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

WORKFLOW = "sync_cardmarket_prices.yml"
LOOKBACK_HOURS = 20
MAX_FAILED = 2
WINDOW_START = (1, 30)  # ora di Roma, inclusa
WINDOW_END = (7, 0)  # ora di Roma, esclusa
ACTIVE_STATUSES = {"queued", "in_progress", "waiting", "pending", "requested"}
IGNORED_CONCLUSIONS = {"cancelled", "skipped"}


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def should_dispatch(now: datetime, runs: list[dict]) -> tuple[bool, str]:
    rome = now.astimezone(ZoneInfo("Europe/Rome"))
    hm = (rome.hour, rome.minute)
    if not (WINDOW_START <= hm < WINDOW_END):
        return False, f"fuori dalla finestra notturna ({rome:%H:%M} a Roma)"
    if any(r.get("status") in ACTIVE_STATUSES for r in runs):
        return False, "un giro Cardmarket e' gia' in coda o in corso"
    since = now - timedelta(hours=LOOKBACK_HOURS)
    failed = 0
    for r in runs:
        if _parse(r["createdAt"]) < since or r.get("conclusion") in IGNORED_CONCLUSIONS:
            continue
        if r.get("conclusion") == "success":
            return False, "gia' un giro riuscito nelle ultime %d ore" % LOOKBACK_HOURS
        failed += 1
    if failed >= MAX_FAILED:
        return False, f"gia' {failed} giri falliti nelle ultime {LOOKBACK_HOURS} ore, riprovo domani"
    return True, f"nessun giro riuscito nelle ultime {LOOKBACK_HOURS} ore ({failed} falliti), ora di Roma {rome:%H:%M}"


def main() -> int:
    out = subprocess.run(
        ["gh", "run", "list", "--workflow", WORKFLOW, "--limit", "20",
         "--json", "createdAt,updatedAt,status,conclusion,event"],
        check=True, capture_output=True, text=True,
    ).stdout
    ok, why = should_dispatch(datetime.now(timezone.utc), json.loads(out))
    print(f"Avvio sync Cardmarket: {'si' if ok else 'no'} ({why})")
    if ok:
        subprocess.run(["gh", "workflow", "run", WORKFLOW], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
