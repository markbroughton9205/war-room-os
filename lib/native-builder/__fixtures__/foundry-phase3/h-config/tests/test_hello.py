import os
import unittest
from unittest import mock

from greeter.hello import greet


class HelloTests(unittest.TestCase):
    def test_plain_by_default(self):
        self.assertEqual(greet("ana"), "hello, ana")

    def test_shouts_when_the_flag_is_on(self):
        with mock.patch.dict(os.environ, {"ENABLE_SHOUTING": "true"}):
            self.assertEqual(greet("ana"), "HELLO, ANA")
