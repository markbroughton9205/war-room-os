import unittest

from store.pricing import member_price


class PricingTests(unittest.TestCase):
    def test_silver_members_get_five_percent(self):
        self.assertEqual(member_price(100.0, {"points": 700}), 95.0)

    def test_gold_members_get_ten_percent_from_one_thousand_points(self):
        self.assertEqual(member_price(100.0, {"points": 1000}), 90.0)
