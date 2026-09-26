import unittest

from notify.alerts import raise_alert


class AlertTests(unittest.TestCase):
    def test_alert_notices_are_capitalised(self):
        self.assertEqual(raise_alert("ana", "low"), "sent to ana: ALERT LOW")
