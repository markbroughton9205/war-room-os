import unittest

from warehouse.stock import reserve


class ShelfScenarioTests(unittest.TestCase):
    def test_reserving_within_stock_lowers_the_level(self):
        self.assertEqual(reserve({"A1": 5}, "A1", 2), 3)

    def test_reserving_more_than_available_is_refused(self):
        levels = {"A1": 1}
        with self.assertRaises(ValueError):
            reserve(levels, "A1", 3)
        self.assertEqual(levels["A1"], 1)

    def test_unknown_sku_is_refused(self):
        with self.assertRaises(ValueError):
            reserve({}, "ZZ", 1)
