"""Ambient buffer, diary opt-in, no-network source check."""

import os
import tempfile
import time
import unittest

from jarvisd.ambient import AmbientBuffer, AmbientRecorder


class TestAmbientBuffer(unittest.TestCase):
    def test_age_pruning_and_recall(self):
        buf = AmbientBuffer(minutes=1)
        now = time.time()
        buf.append("old", at=now - 120)
        buf.append("new", at=now)
        segs = buf.recall()
        texts = [s["text"] for s in segs]
        self.assertNotIn("old", texts)
        self.assertIn("new", texts)
        # Window shorter than age of "new" relative to a frozen clock offset
        buf.append("ancient", at=now - 3600)
        recent = buf.recall(minutes=0.5)
        self.assertEqual([s["text"] for s in recent], ["new"])


class TestAmbientDiary(unittest.TestCase):
    def test_diary_not_written_when_disabled(self):
        with tempfile.TemporaryDirectory() as td:
            cfg = {
                "ambient": {
                    "enabled": False,
                    "bufferMinutes": 5,
                    "diaryEnabled": False,
                    "diaryDir": td,
                    "whisperBin": None,
                    "whisperModel": None,
                }
            }
            rec = AmbientRecorder(cfg)
            self.assertIsNone(rec.write_diary_summary("hello"))
            self.assertEqual(os.listdir(td), [])

    def test_diary_written_when_enabled(self):
        with tempfile.TemporaryDirectory() as td:
            cfg = {
                "ambient": {
                    "enabled": False,
                    "bufferMinutes": 5,
                    "diaryEnabled": True,
                    "diaryDir": td,
                    "whisperBin": None,
                    "whisperModel": None,
                }
            }
            rec = AmbientRecorder(cfg)
            rec.write_diary_summary("hello diary")
            files = os.listdir(td)
            self.assertEqual(len(files), 1)
            self.assertTrue(files[0].endswith(".md"))
            with open(os.path.join(td, files[0]), encoding="utf-8") as f:
                self.assertIn("hello diary", f.read())


class TestAmbientNoNetwork(unittest.TestCase):
    def test_module_has_no_network_imports(self):
        import jarvisd.ambient as amb

        path = amb.__file__
        with open(path, encoding="utf-8") as f:
            src = f.read().lower()
        for needle in ("socket", "urllib", "http.client", "requests", "aiohttp"):
            self.assertNotIn(needle, src, f"ambient.py must not mention {needle}")
        # Also forbid common network call patterns
        self.assertNotIn("http://", src)
        self.assertNotIn("https://", src)


if __name__ == "__main__":
    unittest.main()
