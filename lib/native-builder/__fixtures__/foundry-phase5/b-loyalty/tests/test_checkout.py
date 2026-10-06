import unittest

from store.checkout import checkout_total


class CheckoutTests(unittest.TestCase):
    def test_a_gold_member_pays_the_discounted_total(self):
        self.assertEqual(checkout_total([(50.0, 2)], {"points": 1500}), 90.0)
