import unittest

from store.shipping import shipping_fee


class ShippingTests(unittest.TestCase):
    def test_fee_grows_with_weight(self):
        self.assertEqual(shipping_fee(1.0), 3.7)
