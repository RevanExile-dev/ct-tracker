"""Test di neon_suspend contro un Postgres vero (serve POSTGRES_URL): la
verifica "qualcun altro sta usando il database" legge pg_stat_activity."""
import os
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db
import neon_suspend


class FakeResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


class Recorder:
    def __init__(self, status_code=200, error=None):
        self.calls = []
        self.status_code = status_code
        self.error = error

    def __call__(self, url, headers=None, timeout=None):
        self.calls.append((url, headers, timeout))
        if self.error:
            raise self.error
        return FakeResponse(self.status_code)


def no_sleep(_seconds):
    pass


class TestNeonSuspend(unittest.TestCase):
    def setUp(self):
        self._old = {k: os.environ.get(k) for k in ("NEON_API_KEY", "NEON_PROJECT_ID", "NEON_ENDPOINT_ID")}
        os.environ["NEON_API_KEY"] = "chiave-finta"
        os.environ.pop("NEON_PROJECT_ID", None)
        os.environ.pop("NEON_ENDPOINT_ID", None)

    def tearDown(self):
        for k, v in self._old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def run_suspend(self, post, recent_seconds=1):
        return neon_suspend.suspend_after_sync(
            settle_seconds=0, recent_seconds=recent_seconds, post=post, sleep=no_sleep
        )

    def test_senza_chiave_non_fa_nulla(self):
        del os.environ["NEON_API_KEY"]
        post = Recorder()
        msg = self.run_suspend(post)
        self.assertEqual(post.calls, [])
        self.assertIn("disattivata", msg)

    def test_database_libero_sospende_con_url_e_chiave_giusti(self):
        import time
        time.sleep(1.2)  # lascia scadere l'attivita' recente delle altre connessioni di test
        post = Recorder()
        msg = self.run_suspend(post)
        self.assertEqual(len(post.calls), 1, msg)
        url, headers, timeout = post.calls[0]
        self.assertEqual(
            url,
            "https://console.neon.tech/api/v2/projects/aged-truth-98501688/endpoints/ep-morning-term-b10x2xgm/suspend",
        )
        self.assertEqual(headers["Authorization"], "Bearer chiave-finta")
        self.assertEqual(timeout, neon_suspend.REQUEST_TIMEOUT_SECONDS)

    def test_query_attiva_di_un_altro_impedisce_la_sospensione(self):
        other = db.get_connection()
        started = threading.Event()

        def slow():
            with other.cursor() as cur:
                started.set()
                cur.execute("SELECT pg_sleep(3)")

        t = threading.Thread(target=slow)
        t.start()
        started.wait()
        import time
        time.sleep(0.5)
        post = Recorder()
        msg = self.run_suspend(post)
        t.join()
        other.close()
        self.assertEqual(post.calls, [], msg)
        self.assertIn("saltata", msg)

    def test_attivita_recente_di_un_altro_impedisce_la_sospensione(self):
        other = db.get_connection()
        with other.cursor() as cur:
            cur.execute("SELECT 1")
        other.commit()
        post = Recorder()
        msg = self.run_suspend(post, recent_seconds=30)
        other.close()
        self.assertEqual(post.calls, [], msg)

    def test_errori_dell_api_non_sollevano(self):
        import time
        time.sleep(1.2)
        for post in (Recorder(status_code=401), Recorder(error=RuntimeError("rete giu"))):
            msg = self.run_suspend(post)
            self.assertIn("Sospensione Neon", msg)

    def test_database_irraggiungibile_non_solleva(self):
        old = os.environ.get("POSTGRES_URL")
        os.environ["POSTGRES_URL"] = "postgresql://postgres:x@127.0.0.1:1/nope"
        try:
            post = Recorder()
            msg = self.run_suspend(post)
            self.assertEqual(post.calls, [])
            self.assertIn("errore ignorato", msg)
        finally:
            os.environ["POSTGRES_URL"] = old

    def test_postgres_url_mancante_non_fa_uscire_il_sync(self):
        old = os.environ.pop("POSTGRES_URL")
        try:
            msg = self.run_suspend(Recorder())
            self.assertIn("errore ignorato", msg)
        finally:
            os.environ["POSTGRES_URL"] = old


if __name__ == "__main__":
    unittest.main()
