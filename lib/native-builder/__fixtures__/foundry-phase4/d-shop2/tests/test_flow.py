import unittest

from shop.checkout import place_order

CART = [{"price": 10.0, "qty": 2}, {"price": 5.0, "qty": 2}]


class FlowTests(unittest.TestCase):
    def test_no_code_charges_full_price(self):
        self.assertEqual(place_order(CART), 30.0)

    def test_save20_takes_twenty_percent_off(self):
        self.assertEqual(place_order(CART, "SAVE20"), 24.0)

    def test_unknown_code_changes_nothing(self):
        self.assertEqual(place_order(CART, "BOGUS"), 30.0)
