import unittest

from app.settings import load_settings
from app.title import page_title


class PageTests(unittest.TestCase):
    def test_settings_are_parsed(self):
        self.assertEqual(load_settings("title: Home\nsize: 3\n"), {"title": "Home", "size": 3})

    def test_the_title_is_safe_html(self):
        settings = load_settings("title: A & B\n")
        self.assertEqual(str(page_title(settings)), "<h1>A &amp; B</h1>")
