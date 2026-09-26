import unittest

from shop.reports import sales_report


class ReportTests(unittest.TestCase):
    def test_counts_orders(self):
        self.assertEqual(sales_report([1, 2]), {"orders": 2})
