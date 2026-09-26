import unittest

from notify.digest import weekly_digest


class DigestTests(unittest.TestCase):
    def test_counts_items(self):
        self.assertEqual(weekly_digest([1, 2]), 2)
