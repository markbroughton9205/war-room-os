import unittest

from shipping.rates import fee


class RateTests(unittest.TestCase):
    def test_a_light_parcel(self):
        self.assertEqual(fee(1.0), 4)

    def test_fees_are_rounded_up_to_the_next_whole_euro(self):
        self.assertEqual(fee(1.5), 5)
