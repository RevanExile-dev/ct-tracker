import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dispatch_cardmarket_sync import should_dispatch  # noqa: E402


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def run(created, conclusion="success", status="completed"):
    return {"createdAt": utc(created).isoformat(), "updatedAt": utc(created).isoformat(),
            "status": status, "conclusion": conclusion}


class TestDispatchCardmarketSync(unittest.TestCase):
    def test_giorno_no(self):
        self.assertFalse(should_dispatch(utc("2026-10-12T10:00:00"), [])[0])

    def test_prima_di_mezzanotte_e_mezza_no(self):
        self.assertFalse(should_dispatch(utc("2026-10-11T23:10:00"), [])[0])  # 01:10 CEST

    def test_notte_senza_giri_si(self):
        self.assertTrue(should_dispatch(utc("2026-10-11T23:40:00"), [])[0])  # 01:40 CEST
        self.assertTrue(should_dispatch(utc("2026-10-12T03:00:00"), [])[0])  # 05:00 CEST

    def test_dopo_le_07_no(self):
        self.assertFalse(should_dispatch(utc("2026-10-12T05:10:00"), [])[0])  # 07:10 CEST

    def test_ora_solare(self):
        self.assertFalse(should_dispatch(utc("2026-11-02T00:10:00"), [])[0])  # 01:10 CET
        self.assertTrue(should_dispatch(utc("2026-11-02T00:40:00"), [])[0])   # 01:40 CET
        self.assertFalse(should_dispatch(utc("2026-11-02T06:10:00"), [])[0])  # 07:10 CET

    def test_giro_in_corso_no(self):
        runs = [run("2026-10-11T23:35:00", None, "in_progress")]
        self.assertFalse(should_dispatch(utc("2026-10-12T00:10:00"), runs)[0])

    def test_gia_riuscito_oggi_no(self):
        runs = [run("2026-10-11T21:40:00")]  # il cron e' partito in orario
        self.assertFalse(should_dispatch(utc("2026-10-12T00:10:00"), runs)[0])

    def test_riuscito_ieri_si(self):
        runs = [run("2026-10-10T21:40:00")]  # 26 ore prima
        self.assertTrue(should_dispatch(utc("2026-10-12T00:10:00"), runs)[0])

    def test_un_fallito_si_due_falliti_no(self):
        one = [run("2026-10-11T23:35:00", "failure")]
        two = one + [run("2026-10-11T23:50:00", "failure")]
        self.assertTrue(should_dispatch(utc("2026-10-12T00:10:00"), one)[0])
        self.assertFalse(should_dispatch(utc("2026-10-12T00:40:00"), two)[0])

    def test_cancellati_e_saltati_non_contano(self):
        runs = [run("2026-10-11T23:35:00", "cancelled"), run("2026-10-11T23:50:00", "skipped")]
        self.assertTrue(should_dispatch(utc("2026-10-12T00:10:00"), runs)[0])


if __name__ == "__main__":
    unittest.main()
