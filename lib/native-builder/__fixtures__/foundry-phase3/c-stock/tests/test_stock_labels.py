import unittest

from warehouse.labels import stock_label


class StockLabelTests(unittest.TestCase):
    def test_label_shows_level(self):
        self.assertEqual(stock_label("A1", 4), "A1 (4)")
