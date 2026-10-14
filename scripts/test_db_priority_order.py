"""Test dell'ordine di db.fetch_priority_batch per le carte di catalogo:
le piu' in ritardo rispetto al proprio obiettivo di aggiornamento (eta' /
giorni obiettivo della fascia di prezzo) vengono prima, senza che nessuna
fascia possa restare indietro per sempre. Serve un Postgres vero:

    POSTGRES_URL=postgresql://... python scripts/test_db_priority_order.py

Senza POSTGRES_URL il test viene saltato. Si rifiuta di girare su database
senza "test" o "ci_" nel nome (la variabile ha lo stesso nome di produzione)."""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

DSN = os.environ.get("POSTGRES_URL")
BASE = 3000  # id carte di prova: 3001..


@unittest.skipUnless(DSN, "POSTGRES_URL non impostato")
class PriorityOrder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import db
        cls.db = db
        cls.conn = db.get_connection()
        with cls.conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            name = cur.fetchone()[0]
        if "test" not in name and "ci_" not in name:
            cls.conn.close()
            raise RuntimeError(f"Rifiuto di girare su '{name}': serve un database di prova (nome con 'test' o 'ci_').")
        db.init_db()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def _setup(self, rows):
        """rows: {offset: (best_price_cents o None, ore dall'ultimo tentativo o None)}"""
        c = self.conn.cursor()
        ids = [BASE + k for k in rows]
        c.execute("DELETE FROM blueprints WHERE id = ANY(%s)", (ids,))
        c.execute("INSERT INTO expansions (id, game_id, code, name) VALUES (9999, 5, 'tst', 'Test') ON CONFLICT DO NOTHING")
        for k, (cents, hours) in rows.items():
            c.execute(
                "INSERT INTO blueprints (id, name, expansion_id, expansion_code, expansion_name, category_id) "
                "VALUES (%s, %s, 9999, 'tst', 'Test', 73)", (BASE + k, f"Carta {k}"),
            )
            if hours is not None:
                c.execute(
                    "INSERT INTO latest_prices (blueprint_id, best_price_cents, min_price_cents, "
                    "captured_at_ts, last_attempted_at) VALUES (%s, %s, %s, now() - make_interval(hours => %s), "
                    "now() - make_interval(hours => %s))", (BASE + k, cents, cents, hours, hours),
                )
        self.conn.commit()

    def _order(self, rows):
        batch = self.db.fetch_priority_batch(self.conn, 100000)
        return [r[0] - BASE for r in batch if BASE < r[0] < BASE + 1000 and (r[0] - BASE) in rows]

    def test_mai_vista_prima_poi_il_piu_in_ritardo(self):
        rows = {
            1: (None, None),    # mai tentata: per prima
            2: (2500, 30),      # 25 euro, 30 h (obiettivo 24 h): ritardo 1,25
            3: (500, 30),       # 5 euro, 30 h (obiettivo 72 h): 0,42
            4: (20, 30),        # 0,20 euro, 30 h (obiettivo 168 h): 0,18
            5: (20, 24 * 20),   # 0,20 euro, 20 giorni (obiettivo 7 gg): 2,86 -> prima della 25 euro
        }
        self._setup(rows)
        self.assertEqual(self._order(rows), [1, 5, 2, 3, 4])

    def test_senza_prezzo_e_come_economica(self):
        rows = {
            11: (None, 24 * 8),   # nessuna offerta, 8 gg (obiettivo 7): 1,14
            12: (2500, 24),       # 25 euro, 24 h: 1,0
        }
        self._setup(rows)
        self.assertEqual(self._order(rows), [11, 12])

    def test_fasce_non_catalogo_restano_per_eta_e_prima_del_catalogo(self):
        rows = {21: (2500, 1), 22: (2500, 2000)}
        self._setup(rows)
        c = self.conn.cursor()
        c.execute("DELETE FROM users WHERE email = 'order-test@example.com'")
        c.execute("INSERT INTO users (email) VALUES ('order-test@example.com') RETURNING id")
        uid = c.fetchone()[0]
        c.execute("INSERT INTO wishlist_cards (user_id, blueprint_id) VALUES (%s, %s)", (uid, BASE + 21))
        self.conn.commit()
        try:
            # 21 e' un desiderio (fascia 1) tentato da poco: passa comunque prima della 22 di catalogo, molto piu' vecchia
            self.assertEqual(self._order(rows), [21, 22])
        finally:
            c.execute("DELETE FROM users WHERE email = 'order-test@example.com'")
            self.conn.commit()


if __name__ == "__main__":
    unittest.main()
