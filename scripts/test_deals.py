"""
Test delle parti pure di deals.py ("Affari veri"): quando un prezzo e' un
affare, quando ripetere l'avviso, testo del messaggio. Nessuna rete,
nessun database.

    python scripts/test_deals.py
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deals  # noqa: E402

NOW = datetime(2026, 10, 13, 22, 0, tzinfo=timezone.utc)


class IsDeal(unittest.TestCase):
    def test_sotto_del_25_per_cento_e_almeno_2_euro(self):
        self.assertTrue(deals.is_deal(1800, 3000, 20))   # -40%, 12 euro
        self.assertTrue(deals.is_deal(750, 1000, 5))     # esattamente -25%, 2,50 euro

    def test_sconto_troppo_piccolo(self):
        self.assertFalse(deals.is_deal(2400, 3000, 20))  # -20%

    def test_risparmio_troppo_piccolo(self):
        self.assertFalse(deals.is_deal(301, 500, 20))    # 1,99 euro di risparmio
        self.assertFalse(deals.is_deal(60, 100, 20))     # -40% su una carta da 1 euro

    def test_storico_insufficiente(self):
        self.assertFalse(deals.is_deal(1800, 3000, 4))
        self.assertFalse(deals.is_deal(1800, 3000, 0))

    def test_dati_mancanti(self):
        for current, usual in ((None, 3000), (1800, None), (0, 3000), (1800, 0), (-5, 3000)):
            self.assertFalse(deals.is_deal(current, usual, 20), (current, usual))


class RisparmioEsatto(unittest.TestCase):
    def test_due_euro_esatti_bastano(self):
        # 300 su 500: -40% e 2,00 euro esatti di risparmio -> affare
        self.assertTrue(deals.is_deal(300, 500, 20))


class ShouldNotify(unittest.TestCase):
    def test_prima_volta(self):
        self.assertTrue(deals.should_notify(1800, None, None, NOW))

    def test_non_ripete_entro_7_giorni(self):
        self.assertFalse(deals.should_notify(1800, 1800, NOW - timedelta(days=2), NOW))
        self.assertFalse(deals.should_notify(1650, 1800, NOW - timedelta(days=6, hours=23), NOW))

    def test_ripete_dopo_7_giorni(self):
        self.assertTrue(deals.should_notify(1800, 1800, NOW - timedelta(days=7), NOW))

    def test_ripete_se_scende_ancora_del_10_per_cento(self):
        self.assertTrue(deals.should_notify(1620, 1800, NOW - timedelta(hours=3), NOW))
        self.assertFalse(deals.should_notify(1621, 1800, NOW - timedelta(hours=3), NOW))


class Messaggio(unittest.TestCase):
    def test_testo(self):
        text = deals.format_deal_message("Mew ex", "151", 1800, 3000.0, "EUR", 261377)
        self.assertIn("Mew ex", text)
        self.assertIn("18.00€", text)
        self.assertIn("30.00€", text)
        self.assertIn("−40%", text)
        self.assertIn("https://www.cardtrader.com/cards/261377", text)

    def test_html_escapato(self):
        text = deals.format_deal_message("A <b>&", "Set_*x", 1800, 3000.0, "EUR", 1)
        self.assertIn("A &lt;b&gt;&amp;", text)
        self.assertNotIn("A <b>&", text)

    def test_lunghezza_massima(self):
        text = deals.format_deal_message("x" * 5000, "y" * 5000, 1800, 3000.0, "EUR", 1)
        self.assertLessEqual(len(text), 1024)


if __name__ == "__main__":
    unittest.main()
