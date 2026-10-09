"""Test delle parti pure di sync_external_prices.py (nessuna rete, nessun DB):
    python scripts/test_sync_external_prices.py
Le righe di esempio hanno la forma reale della risposta di tcgcsv
(/tcgplayer/3/<gruppo>/prices); il productId 517045 e' Charizard ex 199/165 (151)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_external_prices as sep  # noqa: E402


class ToCents(unittest.TestCase):
    def test_valori_normali(self):
        self.assertEqual(sep.to_cents(322.37), 32237)
        self.assertEqual(sep.to_cents(0.13), 13)
        self.assertEqual(sep.to_cents(10000.0), 1000000)
        self.assertEqual(sep.to_cents("1.5"), 150)

    def test_arrotondamento_binario(self):
        # 1.005 * 100 = 100.49999999999999 in virgola mobile: round() lo porta a 100,
        # il centesimo esatto non e' recuperabile ne' interessa (riferimento, non fattura)
        self.assertIn(sep.to_cents(1.005), (100, 101))
        self.assertEqual(sep.to_cents(0.29), 29)  # 0.29 * 100 = 28.999999999999996

    def test_zero_resta_zero(self):
        self.assertEqual(sep.to_cents(0), 0)
        self.assertEqual(sep.to_cents(0.0), 0)

    def test_non_validi(self):
        for bad in (None, "", "abc", -1, -0.01, float("nan"), float("inf"), True, 10**12, [1]):
            self.assertIsNone(sep.to_cents(bad), bad)


class BuildRows(unittest.TestCase):
    PRODUCTS = {517045: [261377], 100: [1, 2]}  # il secondo prodotto e' condiviso da due blueprint

    def test_carta_conosciuta(self):
        res = [{"productId": 517045, "lowPrice": 296.0, "midPrice": 360.24, "highPrice": 10000.0,
                "marketPrice": 322.37, "directLowPrice": 303.59, "subTypeName": "Holofoil"}]
        self.assertEqual(sep.build_rows(res, self.PRODUCTS),
                         [(261377, "tcgplayer", "Holofoil", "USD", 32237, 29600, 36024, 1000000)])

    def test_prodotto_sconosciuto_scartato(self):
        self.assertEqual(sep.build_rows([{"productId": 999, "marketPrice": 1.0, "subTypeName": "Normal"}], self.PRODUCTS), [])

    def test_senza_nessun_prezzo_scartata(self):
        res = [{"productId": 517045, "lowPrice": None, "midPrice": None, "highPrice": None,
                "marketPrice": None, "subTypeName": "Normal"}]
        self.assertEqual(sep.build_rows(res, self.PRODUCTS), [])

    def test_solo_alcuni_prezzi(self):
        res = [{"productId": 517045, "lowPrice": 1.0, "marketPrice": None, "subTypeName": "Normal"}]
        self.assertEqual(sep.build_rows(res, self.PRODUCTS),
                         [(261377, "tcgplayer", "Normal", "USD", None, 100, None, None)])

    def test_stesso_prodotto_su_due_blueprint(self):
        res = [{"productId": 100, "marketPrice": 2.0, "subTypeName": "Normal"}]
        rows = sep.build_rows(res, self.PRODUCTS)
        self.assertEqual(sorted(r[0] for r in rows), [1, 2])

    def test_varianti_distinte(self):
        res = [{"productId": 517045, "marketPrice": 3.0, "subTypeName": "Normal"},
               {"productId": 517045, "marketPrice": 5.0, "subTypeName": "Reverse Holofoil"}]
        rows = sep.build_rows(res, self.PRODUCTS)
        self.assertEqual({r[2]: r[4] for r in rows}, {"Normal": 300, "Reverse Holofoil": 500})

    def test_duplicato_vince_chi_ha_il_prezzo_di_mercato(self):
        res = [{"productId": 517045, "marketPrice": 3.0, "subTypeName": "Normal"},
               {"productId": 517045, "marketPrice": None, "lowPrice": 1.0, "subTypeName": "Normal"}]
        rows = sep.build_rows(res, self.PRODUCTS)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][4], 300)

    def test_variante_mancante_diventa_stringa_vuota(self):
        res = [{"productId": 517045, "marketPrice": 3.0}]
        self.assertEqual(sep.build_rows(res, self.PRODUCTS)[0][2], "")


if __name__ == "__main__":
    unittest.main()
