"""
Test delle parti pure di sync_cardmarket_prices.py (nessuna rete, nessun
database): conversione prezzi, lettura del blocco pricing di TCGdex, controllo
di identita', abbinamento per set+numero, scelta delle carte del giorno.

    python scripts/test_sync_cardmarket_prices.py
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_cardmarket_prices as m  # noqa: E402

NOW = datetime(2026, 10, 10, 0, 0, tzinfo=timezone.utc)


class ToCents(unittest.TestCase):
    def test_normali(self):
        self.assertEqual(m.to_cents(402.61), 40261)
        self.assertEqual(m.to_cents(0.02), 2)
        self.assertEqual(m.to_cents(1), 100)
        self.assertEqual(m.to_cents(0.29), 29)  # 0.29*100 = 28.999999999999996 -> arrotondato, non troncato

    def test_assenti_o_assurdi(self):
        for v in (None, 0, 0.0, -1.5, float("nan"), float("inf"), True, "3.5", 1e12):
            self.assertIsNone(m.to_cents(v), v)


class ParsePricing(unittest.TestCase):
    CM = {
        "updated": "2026-10-08T22:54:32.882Z", "unit": "EUR", "idProduct": 733794,
        "avg": 370.41, "low": 109.98, "trend": 402.61, "avg1": 305.25, "avg7": 313.98, "avg30": 381.82,
        "avg-holo": None, "low-holo": None, "trend-holo": 0, "avg1-holo": None, "avg7-holo": None, "avg30-holo": None,
    }

    def test_solo_normale_e_zero_holo_ignorato(self):
        rows = m.parse_pricing({"cardmarket": self.CM, "tcgplayer": None})
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["variant"], "")
        self.assertEqual((r["price_cents"], r["low_cents"], r["mid_cents"]), (40261, 10998, 37041))
        self.assertEqual((r["avg1_cents"], r["avg7_cents"], r["avg30_cents"]), (30525, 31398, 38182))
        self.assertEqual(r["source_updated_at"], datetime(2026, 10, 8, 22, 54, 32, 882000, tzinfo=timezone.utc))

    def test_normale_e_holo(self):
        cm = {**self.CM, "avg-holo": 0.31, "low-holo": 0.05, "trend-holo": 0.33}
        rows = {r["variant"]: r for r in m.parse_pricing({"cardmarket": cm})}
        self.assertEqual(set(rows), {"", "holo"})
        self.assertEqual((rows["holo"]["price_cents"], rows["holo"]["low_cents"], rows["holo"]["mid_cents"]), (33, 5, 31))

    def test_senza_cardmarket_o_valuta_diversa(self):
        self.assertEqual(m.parse_pricing(None), [])
        self.assertEqual(m.parse_pricing({"cardmarket": None, "tcgplayer": {"unit": "USD"}}), [])
        self.assertEqual(m.parse_pricing({"cardmarket": {**self.CM, "unit": "USD"}}), [])
        self.assertEqual(m.parse_pricing({"cardmarket": {"unit": "EUR", "trend": 0, "avg": None}}), [])

    def test_data_illeggibile_non_rompe(self):
        rows = m.parse_pricing({"cardmarket": {**self.CM, "updated": "ieri"}})
        self.assertIsNone(rows[0]["source_updated_at"])


class IdentityConflict(unittest.TestCase):
    def card(self, *third):
        return {"variants_detailed": [{"thirdParty": t} for t in third]}

    def test_cardtrader_coincide(self):
        self.assertIsNone(m.identity_conflict(self.card({"cardtrader": 261377, "tcgplayer": 517045}), 261377, "517045"))

    def test_cardtrader_diverso_vince_su_tcgplayer(self):
        self.assertEqual(m.identity_conflict(self.card({"cardtrader": 1, "tcgplayer": 517045}), 2, "517045"), "cardtrader_id")

    def test_tcgplayer_diverso(self):
        self.assertEqual(m.identity_conflict(self.card({"tcgplayer": 111}), 5, "222"), "tcgplayer_id")

    def test_tcgplayer_tra_piu_varianti(self):
        self.assertIsNone(m.identity_conflict(self.card({"tcgplayer": 111}, {"tcgplayer": 222}), 5, "222"))

    def test_nessun_id_nessuna_verifica(self):
        self.assertIsNone(m.identity_conflict(self.card({}), 5, "222"))
        self.assertIsNone(m.identity_conflict({}, 5, None))
        self.assertIsNone(m.identity_conflict(self.card({"tcgplayer": 111}), 5, None))  # nostro id TCGplayer assente


def sc(local_id, name, cid=None):
    return {"id": cid or f"x-{local_id}", "localId": local_id, "name": name}


class MatchExpansion(unittest.TestCase):
    def test_numero_e_nome(self):
        bps = [
            {"id": 1, "name": "Oddish", "version": "1/98"},
            {"id": 2, "name": "Gloom", "version": "Holo Rare | 002/098"},
            {"id": 3, "name": "Altra carta", "version": "3/98"},       # nome diverso -> scartata (en)
            {"id": 4, "name": "Inesistente", "version": "99/98"},      # numero assente
            {"id": 5, "name": "Senza numero", "version": None},
        ]
        cards = {("en", "aor"): [sc("001", "Oddish"), sc("002", "Gloom"), sc("003", "Vileplume")]}
        out = m.match_expansion(bps, cards, [("en", "aor")])
        self.assertEqual(out, {1: "en:x-001", 2: "en:x-002", 3: None, 4: None, 5: None})

    def test_ambiguo_due_carte_stessa_carta(self):
        bps = [{"id": 1, "name": "Pikachu", "version": "25/165"}, {"id": 2, "name": "Pikachu", "version": "025/165"}]
        out = m.match_expansion(bps, {("en", "s"): [sc("025", "Pikachu")]}, [("en", "s")])
        self.assertEqual(out, {1: None, 2: None})

    def test_giapponese_senza_controllo_nome(self):
        bps = [{"id": 1, "name": "Oddish", "version": "001/190"}]
        out = m.match_expansion(bps, {("ja", "SV4a"): [sc("001", "ナゾノクサ", "SV4a-001")]}, [("ja", "SV4a")])
        self.assertEqual(out, {1: "ja:SV4a-001"})

    def test_sceglie_la_lingua_con_piu_carte(self):
        bps = [{"id": i, "name": "Pikachu", "version": f"{i}/10"} for i in (1, 2, 3)]
        cards = {
            ("en", "e"): [sc("1", "Pikachu", "e-1")],
            ("ja", "J"): [sc("1", "ピカチュウ", "J-1"), sc("2", "ピカチュウ", "J-2"), sc("3", "ピカチュウ", "J-3")],
        }
        out = m.match_expansion(bps, cards, [("en", "e"), ("ja", "J")])
        self.assertEqual(out, {1: "ja:J-1", 2: "ja:J-2", 3: "ja:J-3"})

    def test_set_vuoto_su_tcgdex(self):
        bps = [{"id": 1, "name": "Pikachu", "version": "1/10"}]
        self.assertEqual(m.match_expansion(bps, {("ja", "S4a"): []}, [("ja", "S4a")]), {1: None})

    def test_promo_con_prefisso(self):
        bps = [{"id": 1, "name": "Grookey", "version": "1"}, {"id": 2, "name": "Manaphy", "version": "SWSH275"}]
        cards = {("en", "swshp"): [sc("SWSH001", "Grookey"), sc("SWSH275", "Manaphy")]}
        out = m.match_expansion(bps, cards, [("en", "swshp")])
        self.assertEqual(out, {1: "en:x-SWSH001", 2: "en:x-SWSH275"})


class MatchWithFailedSet(unittest.TestCase):
    def test_set_non_letto_non_e_set_vuoto(self):
        # match_expansion tratta None come "nessuna carta": e' run_mapping a
        # non scrivere nulla per l'espansione. Qui si verifica solo che None
        # non rompa l'abbinamento delle altre lingue.
        bps = [{"id": 1, "name": "Pikachu", "version": "1/10"}]
        cards = {("en", "e"): None, ("ja", "J"): [sc("1", "ピカチュウ", "J-1")]}
        self.assertEqual(m.match_expansion(bps, cards, [("en", "e"), ("ja", "J")]), {1: "ja:J-1"})


class ExternalId(unittest.TestCase):
    def test_roundtrip_e_url(self):
        e = m.make_external_id("ja", "SM1+-001")
        self.assertEqual(m.split_external_id(e), ("ja", "SM1+-001"))
        self.assertTrue(m.card_url(e).endswith("/ja/cards/SM1%2B-001"))  # il '+' va codificato


class ResolveCandidates(unittest.TestCase):
    SNAP = {"en_sets": {"swsh10.5": {"name": "Pokémon GO", "ptcgo": "PGO"}, "svp": {"name": "Scarlet & Violet Black Star Promos", "ptcgo": None}},
            "ja_sets": {"SV4a": {"name": "x"}}}

    def test_overrides_e_ripiego_per_id(self):
        en_sets = {"pokemongo": "swsh10.5"}
        ja_ids = {"sv4a": "SV4a", "sv-p": "SV-P"}
        en_ids = {"svp": "svp", "swsh10.5": "swsh10.5"}
        self.assertEqual(m.resolve_candidates("promosv", "Scarlet & Violet Promos", self.SNAP, en_sets, ja_ids, en_ids), [("ja", "SV-P")])
        self.assertEqual(m.resolve_candidates("svpromo", "SV Black Star Promos", self.SNAP, en_sets, ja_ids, en_ids), [("en", "svp")])
        self.assertEqual(m.resolve_candidates("pkmgo", "Pokémon GO", self.SNAP, en_sets, ja_ids, en_ids), [("en", "swsh10.5")])
        self.assertEqual(m.resolve_candidates("sv4a", "Shiny Treasure ex", self.SNAP, en_sets, ja_ids, en_ids), [("ja", "SV4a")])

    def test_ripiego_per_nome_se_set_nuovo(self):
        out = m.resolve_candidates("zzz", "Set Nuovo", {"en_sets": {}, "ja_sets": {}}, {"setnuovo": "sv99"}, {}, {})
        self.assertEqual(out, [("en", "sv99")])
        self.assertEqual(m.resolve_candidates("qqq", "Boh", {"en_sets": {}, "ja_sets": {}}, {}, {}, {}), [])


class SelectCards(unittest.TestCase):
    def bp(self, i, best=None):
        return {"id": i, "name": "n", "best_price_cents": best, "tcg_player_id": None}

    def test_fasce(self):
        slot = NOW.date().toordinal() % m.ROTATION_DAYS
        old = NOW - timedelta(days=30)
        ids = [slot, slot + 7, slot + 1, slot + 2, slot + 3, slot + 4, slot + 5]
        bps = [self.bp(slot + 7 * 100), self.bp(slot + 1), self.bp(slot + 2, best=m.HIGH_VALUE_CENTS),
               self.bp(slot + 3), self.bp(slot + 4), self.bp(slot + 5), self.bp(slot + 6)]
        rows = {b["id"]: (f"en:{b['id']}", old) for b in bps}
        rows[bps[4]["id"]] = (f"en:{bps[4]['id']}", NOW - timedelta(days=1))   # appena abbinata, senza prezzo
        rows[bps[6]["id"]] = (None, old)                                        # non abbinata
        out = [x["id"] for x in m.select_cards(bps, rows, {bps[3]["id"]}, set(), NOW)]
        # prioritarie: alto valore (2), dell'utente (3), appena abbinata (4); poi la rotazione (0)
        self.assertEqual(sorted(out[:3]), sorted([bps[2]["id"], bps[3]["id"], bps[4]["id"]]))
        self.assertEqual(out[3:], [bps[0]["id"]])
        self.assertNotIn(bps[1]["id"], out)    # fuori turno
        self.assertNotIn(bps[6]["id"], out)    # non abbinata

    def test_carta_vecchia_senza_prezzo_va_a_rotazione(self):
        slot = NOW.date().toordinal() % m.ROTATION_DAYS
        bps = [self.bp(slot + 1)]
        rows = {slot + 1: (f"en:x", NOW - timedelta(days=30))}
        self.assertEqual(m.select_cards(bps, rows, set(), set(), NOW), [])

    def test_all(self):
        bps = [self.bp(1), self.bp(2)]
        rows = {1: ("en:1", NOW - timedelta(days=30)), 2: ("en:2", NOW - timedelta(days=30))}
        self.assertEqual(len(m.select_cards(bps, rows, set(), {1, 2}, NOW, all_cards=True)), 2)


class NeedsMapping(unittest.TestCase):
    def test_regole(self):
        rows = {1: ("en:a", NOW - timedelta(days=100)), 2: (None, NOW - timedelta(days=1)), 3: (None, NOW - timedelta(days=m.RECHECK_UNMATCHED_DAYS + 1))}
        self.assertTrue(m.needs_mapping(rows, 9, NOW))       # mai provata
        self.assertFalse(m.needs_mapping(rows, 1, NOW))      # abbinata: si tiene
        self.assertFalse(m.needs_mapping(rows, 2, NOW))      # non trovata da poco
        self.assertTrue(m.needs_mapping(rows, 3, NOW))       # non trovata da tempo: riprova


class Failures(unittest.TestCase):
    def test_soglia(self):
        self.assertFalse(m.coverage_too_low(0, 0))
        self.assertFalse(m.coverage_too_low(5, 100))
        self.assertTrue(m.coverage_too_low(6, 100))


if __name__ == "__main__":
    unittest.main(verbosity=1)
