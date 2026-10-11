import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dispatch_night_catalog import should_dispatch


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def run(created, minutes, status="completed"):
    c = utc(created)
    u = c.timestamp() + minutes * 60
    return {"createdAt": c.isoformat(), "updatedAt": datetime.fromtimestamp(u, timezone.utc).isoformat(),
            "status": status}


class TestDispatchNightCatalog(unittest.TestCase):
    def test_giorno_no(self):
        self.assertFalse(should_dispatch(utc("2026-10-10T10:00:00"), [])[0])

    def test_notte_senza_giri_si(self):
        self.assertTrue(should_dispatch(utc("2026-10-10T00:31:00"), [])[0])  # 02:31 CEST

    def test_prima_delle_0030_no(self):
        self.assertFalse(should_dispatch(utc("2026-10-09T22:20:00"), [])[0])  # 00:20 CEST

    def test_dopo_le_06_no(self):
        self.assertFalse(should_dispatch(utc("2026-10-10T04:10:00"), [])[0])  # 06:10 CEST

    def test_ora_solare(self):
        self.assertTrue(should_dispatch(utc("2026-11-02T00:00:00"), [])[0])  # 01:00 CET
        self.assertFalse(should_dispatch(utc("2026-11-02T05:30:00"), [])[0])  # 06:30 CET

    def test_giro_in_corso_no(self):
        runs = [run("2026-10-10T00:40:00", 0, "in_progress")]
        self.assertFalse(should_dispatch(utc("2026-10-10T01:30:00"), runs)[0])

    def test_giro_saltato_non_conta(self):
        # un run schedulato uscito dopo 8 secondi non e' un giro vero
        self.assertTrue(should_dispatch(utc("2026-10-10T01:30:00"), [run("2026-10-09T09:28:33", 0.13)])[0])

    def test_quattro_giri_veri_basta(self):
        runs = [run(t, 46) for t in ("2026-10-09T22:30:00", "2026-10-09T23:30:00",
                                      "2026-10-10T00:30:00", "2026-10-10T01:30:00")]
        now = utc("2026-10-10T02:20:00")  # 04:20 CEST
        self.assertFalse(should_dispatch(now, runs)[0])
        self.assertTrue(should_dispatch(now, runs[1:])[0])


if __name__ == "__main__":
    unittest.main()
