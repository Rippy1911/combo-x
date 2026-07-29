"""Config defaults, deep-merge, ~ expansion."""

import json
import os
import tempfile
import unittest

from jarvisd.config import DEFAULT_CONFIG, expand, load_config, save_config


class TestConfig(unittest.TestCase):
    def test_defaults_on_first_run(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "config.json")
            cfg = load_config(path)
            self.assertEqual(cfg["roots"], DEFAULT_CONFIG["roots"])
            self.assertFalse(cfg["ambient"]["enabled"])
            self.assertTrue(os.path.isfile(path))

    def test_deep_merge(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "config.json")
            save_config({"ambient": {"enabled": True}}, path)
            # overwrite with partial only
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"ambient": {"enabled": True}}, f)
            cfg = load_config(path)
            self.assertTrue(cfg["ambient"]["enabled"])
            self.assertEqual(cfg["ambient"]["bufferMinutes"], 5)
            self.assertIn("roots", cfg)
            self.assertEqual(cfg["micOwner"], "offscreen")

    def test_expand(self):
        self.assertEqual(expand("~/foo", home="/Users/me"), "/Users/me/foo")
        self.assertEqual(expand("~", home="/Users/me"), "/Users/me")
        self.assertEqual(expand("/abs", home="/Users/me"), "/abs")
        self.assertIsNone(expand(None))


if __name__ == "__main__":
    unittest.main()
