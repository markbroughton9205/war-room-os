import unittest

from backend.api import list_projects
from frontend.board import show_board

ROWS = [
    {"name": "A", "status": "open"},
    {"name": "B", "status": "closed"},
    {"name": "C", "status": "closed"},
]


class RowTests(unittest.TestCase):
    def test_closed_rows_come_back(self):
        self.assertEqual([item["name"] for item in list_projects(ROWS, status="closed")], ["B", "C"])

    def test_open_rows_come_back(self):
        self.assertEqual([item["name"] for item in list_projects(ROWS, status="open")], ["A"])

    def test_every_closed_row_is_listed(self):
        self.assertEqual(show_board(ROWS, status="closed"), "B\nC")


if __name__ == "__main__":
    unittest.main()
