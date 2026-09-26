import unittest

from billing.invoice import invoice_total

LINES = [{"price": 50.0, "qty": 2}]


class InvoiceTests(unittest.TestCase):
    def test_us_invoice(self):
        self.assertEqual(invoice_total(LINES, "US"), 107.0)

    def test_dutch_customers_are_charged_their_local_tax(self):
        self.assertEqual(invoice_total(LINES, "NL"), 121.0)
