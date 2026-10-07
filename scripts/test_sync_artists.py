"""Test dell'incrocio set+numero di sync_artists.py (nessuna rete, nessun DB):
    python scripts/test_sync_artists.py
Le stringhe `version` sono casi reali del catalogo CardTrader."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_artists as sa  # noqa: E402


class ParseVersion(unittest.TestCase):
    def test_numero_e_totale(self):
        self.assertEqual(sa.parse_version("117/197"), ("117", "197"))
        self.assertEqual(sa.parse_version("Ultra Rare | 221/197"), ("221", "197"))
        self.assertEqual(sa.parse_version("Special Illustraion Rare | 271/264"), ("271", "264"))
        self.assertEqual(sa.parse_version("Holo Annihilape ex Box | 107/193"), ("107", "193"))
        self.assertEqual(sa.parse_version("1/098 "), ("1", "098"))

    def test_galleria_e_promo(self):
        self.assertEqual(sa.parse_version("Special Illustration Rare | TG01/TG30"), ("TG01", "TG30"))
        self.assertEqual(sa.parse_version("001/SV-P"), ("001", "SV-P"))
        self.assertEqual(sa.parse_version("Triplet Beat Sealed Battle Participation Prize 047/SV-P"), ("047", "SV-P"))
        self.assertEqual(sa.parse_version("MEP 025"), ("MEP025", None))
        self.assertEqual(sa.parse_version("SVP 002"), ("SVP002", None))
        self.assertEqual(sa.parse_version("Holo Promo | SM01"), ("SM01", None))
        self.assertEqual(sa.parse_version("Holo Promo | 001"), ("001", None))

    def test_senza_numero(self):
        self.assertEqual(sa.parse_version("Unnumbered"), (None, None))
        self.assertEqual(sa.parse_version(None), (None, None))
        self.assertEqual(sa.parse_version("2017"), (None, None))


class NumberKeys(unittest.TestCase):
    def test_zeri_iniziali(self):
        self.assertEqual(sa.number_keys("001", set())[0], "1")
        self.assertEqual(sa.number_keys("TG01", set())[0], "TG1")
        self.assertEqual(sa.number_keys("100", set())[0], "100")
        self.assertEqual(sa.number_keys("SVP002", set())[0], "SVP2")

    def test_prefisso_proprio_del_set(self):
        # i promo CardTrader omettono il prefisso che la fonte ha (SWSH001)
        self.assertIn("SWSH1", sa.number_keys("001", {"SWSH"}))


class Names(unittest.TestCase):
    def test_nomi_simili(self):
        self.assertTrue(sa.similar_names("Pokémon Catcher", "Pokemon Catcher"))
        self.assertTrue(sa.similar_names("Charizard ex", "Charizard ex"))
        self.assertFalse(sa.similar_names("Pikachu", "Lycanroc"))

    def test_chiave_artista(self):
        self.assertEqual(sa.name_key("AKIRA EGAWA"), sa.name_key("Akira Egawa"))
        self.assertEqual(sa.name_key("aky CG Works"), sa.name_key("akyCG Works"))


class Match(unittest.TestCase):
    def setUp(self):
        self.snap = {
            "en_sets": {"sv3": {"name": "Obsidian Flames", "ptcgo": "OBF", "printed": 197}},
            "en_cards": [["sv3", "117", "Lycanroc", "Sekio"], ["sv3", "223", "Ryme", "AKIRA EGAWA"]],
            "ja_sets": {"SV4a": {"name": "x", "official": 190}},
            "ja_cards": [["SV4a", "001", "ナゾノクサ", "Sekio"]],
        }

    def test_en_per_numero_e_nome(self):
        bps = [
            {"id": 1, "name": "Lycanroc", "version": "117/197", "expansion_id": 1, "expansion_code": "obf", "expansion_name": "Obsidian Flames"},
            {"id": 2, "name": "Ryme", "version": "Special Illustration Rare | 223/197", "expansion_id": 1, "expansion_code": "obf", "expansion_name": "Obsidian Flames"},
            # stesso numero ma carta diversa: NON deve ricevere l'artista
            {"id": 3, "name": "Pikachu", "version": "117/197", "expansion_id": 1, "expansion_code": "obf", "expansion_name": "Obsidian Flames"},
        ]
        got, _report, totals = sa.match_all(bps, self.snap)
        self.assertEqual(got[1], "Sekio")
        self.assertEqual(got[2], "Akira Egawa")  # grafia canonica dal file artisti top
        self.assertNotIn(3, got)
        self.assertEqual(totals["rejected_name"], 1)

    def test_ja_per_codice_set(self):
        bps = [{"id": 9, "name": "Oddish", "version": "001/190", "expansion_id": 2, "expansion_code": "sv4a", "expansion_name": "Shiny Treasure ex"}]
        got, _r, _t = sa.match_all(bps, self.snap)
        self.assertEqual(got[9], "Sekio")


if __name__ == "__main__":
    unittest.main()
