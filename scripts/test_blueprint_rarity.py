"""Test di db._blueprint_rarity (nessun database necessario)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db


class BlueprintRarityTest(unittest.TestCase):
    def test_da_fixed_properties(self):
        self.assertEqual(db._blueprint_rarity({"fixed_properties": {"pokemon_rarity": "Promo"}}), "Promo")

    def test_assente_o_vuota(self):
        self.assertIsNone(db._blueprint_rarity({}))
        self.assertIsNone(db._blueprint_rarity({"fixed_properties": None}))
        self.assertIsNone(db._blueprint_rarity({"fixed_properties": {"pokemon_rarity": "  "}}))
        self.assertIsNone(db._blueprint_rarity({"fixed_properties": {"collector_number": "1"}}))


if __name__ == "__main__":
    unittest.main()
