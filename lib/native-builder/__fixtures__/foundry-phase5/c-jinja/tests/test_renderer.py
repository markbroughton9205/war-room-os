import unittest

from reports.renderer import bold, render_row


class RendererTests(unittest.TestCase):
    def test_bold_escapes_the_text(self):
        self.assertEqual(str(bold("a<b")), "<b>a&lt;b</b>")

    def test_row_shows_the_name_and_the_amount(self):
        self.assertEqual(render_row("x&y", 3), "<tr><td>x&amp;y</td><td>3.00</td></tr>")
