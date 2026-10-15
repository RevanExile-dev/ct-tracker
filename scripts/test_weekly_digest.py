"""Test del riepilogo settimanale (scripts/weekly_digest.py) con utenti
simulati su un Postgres vero. NON manda nessun messaggio: si ferma alla coda
telegram_outbox.

    POSTGRES_URL=postgresql://... python scripts/test_weekly_digest.py

Senza POSTGRES_URL il test viene saltato. Si rifiuta di girare su database
senza "test" o "ci_" nel nome."""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

DSN = os.environ.get("POSTGRES_URL")
BASE = 7000  # id carte di prova: 7001..
# Domenica 2026-10-18, 11:00 di Roma (UTC+2) = 09:00 UTC; settimana ISO 2026-W42.
SUNDAY = datetime(2026, 10, 18, 9, 0, tzinfo=timezone.utc)


@unittest.skipUnless(DSN, "POSTGRES_URL non impostato")
class WeeklyDigest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import db
        import weekly_digest
        cls.db, cls.wd = db, weekly_digest
        cls.conn = db.get_connection()
        with cls.conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            name = cur.fetchone()[0]
        if "test" not in name and "ci_" not in name:
            cls.conn.close()
            raise RuntimeError(f"Rifiuto di girare su '{name}': serve un database di prova.")
        db.init_db()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.users = []
        c = self.conn.cursor()
        c.execute("DELETE FROM blueprints WHERE id BETWEEN %s AND %s", (BASE, BASE + 99))
        c.execute("INSERT INTO expansions (id, game_id, code, name) VALUES (9998, 5, 'tsd', 'Test <Set>') ON CONFLICT DO NOTHING")
        # 7001 sale +50%, 7002 scende -40%, 7003 quasi ferma, 7004 prezzo vecchio (non fresco)
        for k, (name, old, new, fresh) in {
            1: ("Rialzo & Co", 1000, 1500, True), 2: ("Ribasso", 2000, 1200, True),
            3: ("Ferma", 1000, 1010, True), 4: ("Stantia", 1000, 3000, False),
        }.items():
            c.execute("INSERT INTO blueprints (id, name, expansion_id, expansion_code, expansion_name, category_id) "
                      "VALUES (%s, %s, 9998, 'tsd', 'Test <Set>', 73)", (BASE + k, name))
            c.execute("INSERT INTO latest_prices (blueprint_id, best_price_cents, best_price_currency, min_price_cents, captured_at_ts) "
                      "VALUES (%s, %s, 'EUR', %s, now() - make_interval(days => %s))",
                      (BASE + k, new, new, 0 if fresh else 5))
            c.execute("INSERT INTO price_snapshots (blueprint_id, captured_at, captured_at_ts, best_price_cents) "
                      "VALUES (%s, %s, now(), %s)", (BASE + k, (SUNDAY - timedelta(days=8)).date(), old))
        self.conn.commit()

    def tearDown(self):
        c = self.conn.cursor()
        for uid in self.users:
            c.execute("DELETE FROM users WHERE id = %s", (uid,))
        c.execute("DELETE FROM telegram_outbox WHERE dedup_key LIKE 'digest:%%'")
        c.execute("DELETE FROM blueprints WHERE id BETWEEN %s AND %s", (BASE, BASE + 99))
        self.conn.commit()

    def _user(self, chat_id, digest=True, binder=(), snapshots=()):
        uid = str(uuid.uuid4())
        self.users.append(uid)
        c = self.conn.cursor()
        c.execute("INSERT INTO users (id, email) VALUES (%s, %s)", (uid, f"{uid}@test.invalid"))
        c.execute("INSERT INTO telegram_links (user_id, chat_id, weekly_digest) VALUES (%s, %s, %s)", (uid, chat_id, digest))
        for k in binder:
            c.execute("INSERT INTO binder_cards (user_id, blueprint_id) VALUES (%s, %s)", (uid, BASE + k))
        for days_ago, total in snapshots:
            c.execute("INSERT INTO binder_value_snapshots (user_id, captured_at, total_cents, currency, cards_count, priced_count) "
                      "VALUES (%s, %s, %s, 'EUR', 2, 2)", (uid, (SUNDAY - timedelta(days=days_ago)).date(), total))
        self.conn.commit()
        return uid

    def _outbox(self, uid):
        c = self.conn.cursor()
        c.execute("SELECT payload, chat_id, alert_id FROM telegram_outbox WHERE dedup_key LIKE %s", (f"digest:{uid}:%",))
        return c.fetchall()

    def test_window(self):
        wd = self.wd
        self.assertEqual(wd.digest_week_key(SUNDAY), "2026-W42")
        self.assertIsNone(wd.digest_week_key(SUNDAY - timedelta(days=1)))    # sabato
        self.assertIsNone(wd.digest_week_key(SUNDAY + timedelta(days=1)))    # lunedi'
        # 07:59 UTC = 09:59 a Roma: ancora fuori; 08:00 UTC = 10:00: dentro
        self.assertIsNone(wd.digest_week_key(datetime(2026, 10, 18, 7, 59, tzinfo=timezone.utc)))
        self.assertEqual(wd.digest_week_key(datetime(2026, 10, 18, 8, 0, tzinfo=timezone.utc)), "2026-W42")

    def test_outside_window_runs_no_query(self):
        class Boom:
            def cursor(self):
                raise AssertionError("nessuna query fuori finestra")
        self.assertEqual(self.wd.queue_weekly_digests(Boom(), SUNDAY - timedelta(days=2)), (0, 0))

    def test_content_and_dedup(self):
        uid = self._user(111, binder=(1, 2, 3, 4), snapshots=((8, 10000), (0, 12000)))
        c = self.conn.cursor()
        c.execute("INSERT INTO price_alerts (user_id, blueprint_id, target_type, target_value, state, fired_at) "
                  "VALUES (%s, %s, 'absolute_cents', 1300, 'fired', now() - interval '2 days')", (uid, BASE + 2))
        self.conn.commit()
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (1, 0))
        rows = self._outbox(uid)
        self.assertEqual(len(rows), 1)
        text, chat_id, alert_id = rows[0]
        self.assertEqual(chat_id, 111)
        self.assertIsNone(alert_id)
        self.assertIn("120.00€", text)
        self.assertIn("+20.0% in 7 giorni", text)
        self.assertIn("Hanno toccato il tuo obiettivo", text)
        self.assertIn("Rialzo &amp; Co", text)         # escape HTML
        self.assertIn("Test &lt;Set&gt;", text)
        self.assertIn("▲ 50%", text)
        self.assertIn("▼ 40%", text)
        self.assertNotIn("Ferma", text)                # +1%: sotto la soglia
        self.assertNotIn("Stantia", text)              # prezzo non fresco: niente rialzo inventato
        # secondo giro nella stessa domenica: nessun doppione
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (0, 0))
        self.assertEqual(len(self._outbox(uid)), 1)
        # settimana dopo: di nuovo
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY + timedelta(days=7)), (1, 0))

    def test_off_by_default_and_unlinked(self):
        off = self._user(222, digest=False, binder=(1,), snapshots=((0, 5000),))
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (0, 0))
        self.assertEqual(self._outbox(off), [])
        c = self.conn.cursor()
        c.execute("SELECT column_default FROM information_schema.columns WHERE table_name='telegram_links' AND column_name='weekly_digest'")
        self.assertEqual(c.fetchone()[0], "false")

    def test_nothing_to_say_sends_nothing(self):
        uid = self._user(333)  # binder vuoto, nessun allarme
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (0, 1))
        self.assertEqual(self._outbox(uid), [])
        c = self.conn.cursor()
        c.execute("SELECT last_digest_week FROM telegram_links WHERE user_id = %s", (uid,))
        self.assertEqual(c.fetchone()[0], "2026-W42")  # segnato: non ricontrollato ad ogni giro

    def test_batches(self):
        n = self.wd.DIGEST_BATCH_USERS
        for i in range(n + 5):
            self._user(5000 + i, binder=(1,), snapshots=((0, 100),))
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (n, 0))
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (5, 0))
        self.assertEqual(self.wd.queue_weekly_digests(self.conn, SUNDAY), (0, 0))

    def test_outbox_fetch_includes_dedup_key_for_markup(self):
        uid = self._user(444, binder=(1,), snapshots=((0, 100),))
        self.wd.queue_weekly_digests(self.conn, SUNDAY)
        pending = [r for r in self.db.fetch_pending_outbox(self.conn, 500) if r[5] == f"digest:{uid}:2026-W42"]
        self.assertEqual(len(pending), 1)
        self.assertIsNone(self.db.alert_reply_markup(pending[0][4]))
        self.assertEqual(self.wd.digest_reply_markup()["inline_keyboard"][0][0]["callback_data"], "wd:off")


if __name__ == "__main__":
    unittest.main()
