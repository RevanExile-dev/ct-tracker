"""Test di equivalenza: db.write_price_batch (scrittura a blocchi) deve lasciare
nel database ESATTAMENTE le stesse righe del percorso vecchio per-carta
(insert_price_snapshot + upsert_latest_price + replace_price_listings +
valutazione allarmi + update rarita'). Serve un Postgres vero:

    POSTGRES_URL=postgresql://... python scripts/test_db_price_batch.py

Senza POSTGRES_URL il test viene saltato (il CI backend ne fornisce uno).
Le carte "vecchie" hanno id 1..N, quelle "nuove" 1001..1000+N, con le stesse
offerte: dopo aver scritto le une col percorso vecchio e le altre a blocchi,
le tabelle devono coincidere riga per riga (a meno dell'id)."""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

DSN = os.environ.get("POSTGRES_URL")
TODAY = "2026-10-14"
NOW_TS = "2026-10-14T12:00:00+00:00"
OFFSET = 1000


def offer(oid, cents, cond="Near Mint", lang="it", zero=True, user="u", qty=1, rarity="Common"):
    return {
        "id": oid, "price": {"cents": cents, "currency": "EUR"}, "quantity": qty,
        "properties_hash": {"condition": cond, "pokemon_language": lang, "pokemon_rarity": rarity},
        "user": {"username": f"{user}{oid}", "can_sell_via_hub": zero, "country_code": "IT"},
    }


# Casi: carta normale, solo EN, nessuna offerta, offerta senza prezzo, >25 offerte,
# senza serie IT+NM+Zero, carta con allarme che scatta, carta con allarme che non scatta.
CASES = {
    1: [offer(1, 500), offer(2, 450, cond="Slightly Played"), offer(3, 900, zero=False)],
    2: [offer(4, 1200, lang="en"), offer(5, 1300, lang="en", cond="Played")],
    3: [],
    4: [offer(6, 700), {"id": 7, "quantity": 1}],
    5: [offer(100 + i, 100 + i * 10, lang="it" if i % 2 else "en") for i in range(40)],
    6: [offer(8, 250, lang="jp", zero=False)],
    7: [offer(9, 80), offer(10, 120, rarity="Rare")],
    8: [offer(11, 5000), offer(12, 5200)],
}


@unittest.skipUnless(DSN, "POSTGRES_URL non impostato")
class WritePriceBatchEquivalence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import db
        cls.db = db
        cls.conn = db.get_connection()
        # Il nome della variabile e' lo stesso del database di produzione: mai
        # scrivere carte finte li'. Si lavora solo su database di prova.
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

    def setUp(self):
        c = self.conn.cursor()
        ids = [i for k in CASES for i in (k, k + OFFSET)]
        c.execute("DELETE FROM users WHERE email = 'batch-test@example.com'")  # a cascata: allarmi, coda, collegamento
        c.execute("DELETE FROM blueprints WHERE id = ANY(%s)", (ids,))  # a cascata: prezzi, storico, offerte
        c.execute("INSERT INTO expansions (id, game_id, code, name) VALUES (9999, 5, 'tst', 'Test') ON CONFLICT DO NOTHING")
        for k in CASES:
            for bid in (k, k + OFFSET):
                c.execute(
                    "INSERT INTO blueprints (id, name, expansion_id, expansion_code, expansion_name, category_id) "
                    "VALUES (%s, %s, 9999, 'tst', 'Test', 73)", (bid, f"Carta {k}"),
                )
        # storico di ieri e di 3 giorni fa per testare i "precedenti"
        for k in (1, 2, 5, 7):
            for bid in (k, k + OFFSET):
                c.execute(
                    "INSERT INTO price_snapshots (blueprint_id, captured_at, captured_at_ts, min_price_cents, "
                    "best_price_cents, it_nm_zero_price_cents, listings_count) VALUES "
                    "(%s, '2026-10-13', '2026-10-13T12:00:00Z', 600, 650, 700, 3), "
                    "(%s, '2026-10-11', '2026-10-11T12:00:00Z', 580, 640, NULL, 3), "
                    "(%s, %s, %s, 111, 111, 111, 1)",
                    (bid, bid, bid, TODAY, "2026-10-14T01:00:00Z"),  # punto di OGGI gia' presente: va sostituito
                )
        c.execute("INSERT INTO users (email) VALUES ('batch-test@example.com') RETURNING id")
        uid = c.fetchone()[0]
        c.execute("INSERT INTO telegram_links (user_id, chat_id) VALUES (%s, 424242)", (uid,))
        for bid in (1, 8, 1 + OFFSET, 8 + OFFSET):
            target = 600 if bid % OFFSET == 1 else 100  # il primo scatta (500 <= 600), il secondo no
            c.execute(
                "INSERT INTO price_alerts (user_id, blueprint_id, language, target_type, target_value, languages) "
                "VALUES (%s, %s, 'it', 'absolute_cents', %s, ARRAY['it'])", (uid, bid, target),
            )
        self.conn.commit()

    def _rarity(self, products):
        if not products:
            return None
        props = products[0].get("properties_hash", {}) or {}
        return props.get("pokemon_rarity") or props.get("rarity")

    def _old_path(self):
        db = self.db
        for k, products in CASES.items():
            db.insert_price_snapshot(self.conn, k, TODAY, NOW_TS, products)
            db.upsert_latest_price(self.conn, k, TODAY, NOW_TS, products)
            db.replace_price_listings(self.conn, k, TODAY, products)
            db.evaluate_price_alerts_for_blueprint(self.conn, k, f"Carta {k}", "Test")
            r = self._rarity(products)
            if r:
                with self.conn.cursor() as cur:
                    cur.execute("UPDATE blueprints SET rarity = %s WHERE id = %s", (r, k))
            self.conn.commit()

    def _new_path(self):
        items = [(k + OFFSET, f"Carta {k}", "Test", products, self._rarity(products)) for k, products in CASES.items()]
        self.db.write_price_batch(self.conn, TODAY, NOW_TS, items)
        self.conn.commit()

    def _rows(self, sql, offset):
        with self.conn.cursor() as cur:
            cur.execute(sql, (offset,))
            return cur.fetchall()

    def test_stesse_righe(self):
        self._old_path()
        self._new_path()
        tables = {
            "latest_prices": "SELECT blueprint_id - %s, captured_at, captured_at_ts, min_price_cents, min_price_currency, "
                "avg_price_cents, listings_count, cheapest_condition, cheapest_language, cheapest_foil, languages_available, "
                "prev_price_cents, prev_captured_at, best_price_cents, best_price_currency, best_condition, best_language, "
                "best_can_sell_via_hub, prev_best_price_cents, it_nm_zero_price_cents, it_nm_zero_price_currency, "
                "it_nm_zero_listings_count, prev_it_nm_zero_price_cents, prev_it_nm_zero_captured_at "
                "FROM latest_prices WHERE blueprint_id %s ORDER BY 1",
            "price_snapshots": "SELECT blueprint_id - %s, captured_at, captured_at_ts, min_price_cents, min_price_currency, "
                "avg_price_cents, listings_count, cheapest_condition, cheapest_language, cheapest_foil, best_price_cents, "
                "it_nm_zero_price_cents FROM price_snapshots WHERE blueprint_id %s ORDER BY 1, 2, 4",
            "price_listings": "SELECT blueprint_id - %s, captured_at, price_cents, price_currency, condition, language, "
                "quantity, seller_username, can_sell_via_hub, ships_from_country FROM price_listings WHERE blueprint_id %s "
                "ORDER BY 1, price_cents, seller_username",
            "blueprints": "SELECT id - %s, rarity FROM blueprints WHERE id %s ORDER BY 1",
            "price_alerts": "SELECT blueprint_id - %s, state, (fired_at IS NOT NULL) FROM price_alerts WHERE blueprint_id %s ORDER BY 1",
            "telegram_outbox": "SELECT a.blueprint_id - %s, o.chat_id, o.payload FROM telegram_outbox o JOIN price_alerts a "
                "ON a.id = o.alert_id WHERE a.blueprint_id %s ORDER BY 1",
        }
        for name, sql in tables.items():
            old_sql = sql.replace("%s", "%s", 1).replace("blueprint_id %s", "blueprint_id BETWEEN 1 AND 999").replace("id %s", "id BETWEEN 1 AND 999")
            new_sql = sql.replace("blueprint_id %s", "blueprint_id BETWEEN 1001 AND 1999").replace("id %s", "id BETWEEN 1001 AND 1999")
            old = self._rows(old_sql, 0)
            new = self._rows(new_sql, OFFSET)
            self.assertTrue(old, f"{name}: nessuna riga di confronto")
            if name == "telegram_outbox":
                # il testo contiene il link/id della carta: confronto solo chat e presenza
                old = [(r[0], r[1]) for r in old]
                new = [(r[0], r[1]) for r in new]
            self.assertEqual(old, new, f"{name}: il percorso a blocchi scrive righe diverse")

    def test_punto_di_oggi_sostituito_non_duplicato(self):
        self._new_path()
        with self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM price_snapshots WHERE blueprint_id = %s AND captured_at = %s", (1 + OFFSET, TODAY))
            self.assertEqual(cur.fetchone()[0], 1)

    def test_rilancio_stesso_giorno_non_duplica(self):
        self._new_path()
        self._new_path()
        with self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM price_listings WHERE blueprint_id = %s", (5 + OFFSET,))
            self.assertEqual(cur.fetchone()[0], 25)
            cur.execute("SELECT count(*) FROM price_snapshots WHERE blueprint_id = %s AND captured_at = %s", (5 + OFFSET, TODAY))
            self.assertEqual(cur.fetchone()[0], 1)

    def test_mark_attempted_many(self):
        self.db.mark_attempted_many(self.conn, [1, 2, 3, 3], "2026-10-14T10:00:00+00:00")
        self.conn.commit()
        with self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM latest_prices WHERE blueprint_id IN (1,2,3) AND last_attempted_at IS NOT NULL")
            self.assertEqual(cur.fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()
