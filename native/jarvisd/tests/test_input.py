"""Input combo grammar + secure/sensitive refusals."""

import unittest

from jarvisd.errors import BadRequest, PermissionDenied
from jarvisd.input import FakeEventBackend, Input, parse_key_combo


class TestComboGrammar(unittest.TestCase):
    def test_valid(self):
        mods, key = parse_key_combo("cmd+shift+s")
        self.assertEqual(mods, ["cmd", "shift"])
        self.assertEqual(key, "s")
        mods, key = parse_key_combo("command+return")
        self.assertIn("command", mods)
        self.assertEqual(key, "return")
        mods, key = parse_key_combo("f5")
        self.assertEqual(key, "f5")

    def test_invalid(self):
        with self.assertRaises(BadRequest):
            parse_key_combo("")
        with self.assertRaises(BadRequest):
            parse_key_combo("cmd+@@@")
        with self.assertRaises(BadRequest):
            parse_key_combo("notamod+s")


class TestInputSafety(unittest.TestCase):
    def test_secure_field_refused(self):
        be = FakeEventBackend(frontmost={"name": "Safari", "bundleId": "com.apple.Safari"})
        inp = Input(event_backend=be)
        node = {
            "role": "AXSecureTextField",
            "app": "Safari",
            "bundleId": "com.apple.Safari",
            "frame": {"x": 0, "y": 0, "w": 10, "h": 10},
        }
        with self.assertRaises(PermissionDenied) as ctx:
            inp.type_text("secret", node=node)
        self.assertEqual(ctx.exception.code, "denied:secure_field")

    def test_sensitive_frontmost_refused(self):
        be = FakeEventBackend(
            frontmost={"name": "Terminal", "bundleId": "com.apple.Terminal"}
        )
        inp = Input(event_backend=be)
        with self.assertRaises(PermissionDenied) as ctx:
            inp.click({"x": 10, "y": 10})
        self.assertEqual(ctx.exception.code, "denied:sensitive_app")

    def test_click_and_type_ok(self):
        be = FakeEventBackend(frontmost={"name": "TextEdit", "bundleId": "com.apple.TextEdit"})
        inp = Input(event_backend=be)
        node = {
            "role": "AXTextField",
            "app": "TextEdit",
            "bundleId": "com.apple.TextEdit",
            "frame": {"x": 0, "y": 0, "w": 100, "h": 20},
        }
        self.assertTrue(inp.click(node)["clicked"])
        self.assertTrue(inp.type_text("hi", node=node)["typed"])
        self.assertTrue(inp.send_combo("cmd+s")["sent"])
        self.assertTrue(any(e[0] == "click" for e in be.events))


if __name__ == "__main__":
    unittest.main()
