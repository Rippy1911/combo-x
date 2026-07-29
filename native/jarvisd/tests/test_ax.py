"""UiTree against a fake AX backend."""

import unittest

from jarvisd.ax import FakeAxBackend, UiTree
from jarvisd.errors import BadRequest, PermissionDenied, Unavailable


class TestUiTree(unittest.TestCase):
    def _forest(self, n=5):
        kids = []
        for i in range(n):
            kids.append(
                {
                    "role": "AXButton",
                    "title": f"Btn{i}",
                    "value": None,
                    "enabled": True,
                    "focused": False,
                    "frame": {"x": i * 10, "y": 0, "w": 40, "h": 20},
                    "actions": ["AXPress"],
                    "_children": [],
                }
            )
        return kids

    def test_walk_and_resolve(self):
        apps = [{"name": "TextEdit", "bundleId": "com.apple.TextEdit", "pid": 42, "frontmost": True}]
        be = FakeAxBackend(forest=self._forest(3), apps=apps)
        tree = UiTree(ax_backend=be)
        out = tree.walk(max_nodes=200)
        self.assertEqual(len(out["nodes"]), 3)
        self.assertFalse(out["truncated"])
        node = tree.resolve(1)
        self.assertEqual(node["title"], "Btn1")
        self.assertEqual(node["index"], 1)

    def test_max_nodes_truncation(self):
        apps = [{"name": "TextEdit", "bundleId": "com.apple.TextEdit", "pid": 42, "frontmost": True}]
        be = FakeAxBackend(forest=self._forest(10), apps=apps)
        tree = UiTree(ax_backend=be)
        out = tree.walk(max_nodes=4)
        self.assertEqual(len(out["nodes"]), 4)
        self.assertTrue(out["truncated"])

    def test_stale_index(self):
        tree = UiTree(ax_backend=FakeAxBackend(forest=[], apps=[]))
        with self.assertRaises(BadRequest) as ctx:
            tree.resolve(0)
        self.assertEqual(ctx.exception.code, "bad_request:stale_index")

    def test_untrusted(self):
        be = FakeAxBackend(trusted=False, apps=[])
        tree = UiTree(ax_backend=be)
        with self.assertRaises(Unavailable) as ctx:
            tree.walk()
        self.assertEqual(ctx.exception.code, "unavailable:accessibility")

    def test_sensitive_app_explicit(self):
        apps = [
            {
                "name": "1Password",
                "bundleId": "com.1password.1password",
                "pid": 9,
                "frontmost": True,
            }
        ]
        be = FakeAxBackend(forest=self._forest(1), apps=apps)
        tree = UiTree(ax_backend=be)
        with self.assertRaises(PermissionDenied) as ctx:
            tree.walk(app="1Password")
        self.assertEqual(ctx.exception.code, "denied:sensitive_app")


if __name__ == "__main__":
    unittest.main()
