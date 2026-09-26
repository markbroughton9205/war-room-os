import unittest

from greeter.hello import greet


class HelloTests(unittest.TestCase):
    def test_greeting_ends_with_an_exclamation_mark(self):
        self.assertEqual(greet("ana"), "hello, ana!")
