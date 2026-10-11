"""
Avvia il sync del catalogo (sync_prices_catalog.yml) dai giri frequenti delle
carte tracciate, di notte (ora di Roma).

Perche': GitHub ritarda o salta i cron, anche di ore (la notte del 10/10/2026
nessuno dei 4 giri del catalogo schedulati tra le 00:30 e le 03:30 UTC e'
partito). I giri delle tracciate invece sono puntuali ogni 30 minuti perche'
li lancia il ping esterno di cron-job.org: li usiamo come "orologio".

Regole (tutte devono valere per avviare un giro):
  - ora di Roma tra le 00:30 e le 06:00 (Europe/Rome gestisce ora legale/solare);
  - nessun giro del catalogo gia' in coda o in corso;
  - meno di MAX_PER_NIGHT giri "veri" del catalogo nelle ultime 7 ore.
Un giro "vero" e' uno che e' durato almeno 5 minuti: i run schedulati fuori
finestra, che escono dopo pochi secondi (vedi il passo "Finestra notturna" in
sync_prices_catalog.yml), non contano.

Uso (nel workflow, con GH_TOKEN e permesso actions: write):
  python scripts/dispatch_night_catalog.py
"""
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

WORKFLOW = "sync_prices_catalog.yml"
MAX_PER_NIGHT = 4
LOOKBACK_HOURS = 7
MIN_REAL_RUN_MINUTES = 5
NIGHT_START = (0, 30)  # ora di Roma, inclusa
NIGHT_END = (6, 0)  # ora di Roma, esclusa
ACTIVE_STATUSES = {"queued", "in_progress", "waiting", "pending", "requested"}


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def should_dispatch(now: datetime, runs: list[dict]) -> tuple[bool, str]:
    rome = now.astimezone(ZoneInfo("Europe/Rome"))
    hm = (rome.hour, rome.minute)
    if not (NIGHT_START <= hm < NIGHT_END):
        return False, f"fuori dalla notte italiana ({rome:%H:%M})"
    if any(r.get("status") in ACTIVE_STATUSES for r in runs):
        return False, "un giro del catalogo e' gia' in coda o in corso"
    since = now - timedelta(hours=LOOKBACK_HOURS)
    real = 0
    for r in runs:
        created = _parse(r["createdAt"])
        if created < since:
            continue
        minutes = (_parse(r["updatedAt"]) - created).total_seconds() / 60
        if minutes >= MIN_REAL_RUN_MINUTES:
            real += 1
    if real >= MAX_PER_NIGHT:
        return False, f"gia' {real} giri del catalogo nelle ultime {LOOKBACK_HOURS} ore"
    return True, f"{real} giri del catalogo nelle ultime {LOOKBACK_HOURS} ore, ora di Roma {rome:%H:%M}"


def main() -> int:
    out = subprocess.run(
        ["gh", "run", "list", "--workflow", WORKFLOW, "--limit", "30",
         "--json", "createdAt,updatedAt,status,conclusion,event"],
        check=True, capture_output=True, text=True,
    ).stdout
    ok, why = should_dispatch(datetime.now(timezone.utc), json.loads(out))
    print(f"Avvio catalogo notturno: {'si' if ok else 'no'} ({why})")
    if ok:
        subprocess.run(["gh", "workflow", "run", WORKFLOW], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
