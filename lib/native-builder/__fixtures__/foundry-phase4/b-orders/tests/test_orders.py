import unittest

from orders.repository import list_orders
from orders.report import order_lines

ROWS = [
    {"id": "A", "status": "open", "customer": "ana"},
    {"id": "B", "status": "closed", "customer": "ana"},
    {"id": "C", "status": "closed", "customer": "bo"},
]


class OrderTests(unittest.TestCase):
    def test_closed_orders_come_back(self):
        self.assertEqual([order["id"] for order in list_orders(ROWS, "closed")], ["B", "C"])

    def test_open_orders_come_back(self):
        self.assertEqual([order["id"] for order in list_orders(ROWS, "open")], ["A"])

    def test_report_lists_every_closed_order(self):
        self.assertEqual(order_lines(ROWS, "closed"), "B\nC")
