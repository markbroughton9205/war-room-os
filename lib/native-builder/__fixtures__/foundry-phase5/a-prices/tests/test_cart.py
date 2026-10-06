import unittest

from prices.cart import cart_total


class CartTests(unittest.TestCase):
    def test_total_uses_the_catalog_prices(self):
        self.assertEqual(cart_total([("apple", 2), ("pear", 1)]), 5.25)
