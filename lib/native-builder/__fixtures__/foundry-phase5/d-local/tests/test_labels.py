import unittest

from shipping.labels import label


class LabelTests(unittest.TestCase):
    def test_label(self):
        self.assertEqual(label(7, "Utrecht"), "#7 -> Utrecht")
