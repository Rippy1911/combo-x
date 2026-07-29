"""Indexer command/env, debounce, path denial."""

import os
import tempfile
import unittest
from types import SimpleNamespace

from jarvisd.errors import PermissionDenied
from jarvisd.indexer import Indexer


class TestIndexer(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.corpus = self.td.name
        with open(os.path.join(self.corpus, "a.md"), "w", encoding="utf-8") as f:
            f.write("# hi\n")
        self.calls = []

        def fake_run(cmd, cwd=None, env=None, capture_output=None, text=None, check=None):
            self.calls.append({"cmd": cmd, "cwd": cwd, "env": env})
            out = (
                "corpus: 3 files across _docs\n"
                "DONE: 3 files, 12 chunks parsed, 2 embedded, 2 upserts, 0 unchanged, "
                "0 files skipped, 0 stale paths pruned.\n"
            )
            return SimpleNamespace(stdout=out, stderr="", returncode=0)

        self.fake_run = fake_run
        self.cfg = {
            "roots": [self.corpus],
            "indexer": {"nsRagDir": "/tmp/fake-ns-rag", "debounceMs": 5000},
        }
        self.clock = {"t": 1000.0}

        def now():
            return self.clock["t"]

        self.idx = Indexer(self.cfg, runner=self.fake_run, clock=now)

    def tearDown(self):
        self.td.cleanup()

    def test_command_and_env(self):
        out = self.idx.index_dir(self.corpus, realpath=lambda p: p)
        self.assertEqual(self.calls[0]["cmd"], ["npm", "run", "ingest"])
        self.assertEqual(self.calls[0]["cwd"], "/tmp/fake-ns-rag")
        self.assertEqual(self.calls[0]["env"]["NS_RAG_CORPUS"], self.corpus)
        self.assertEqual(out["files"], 3)
        self.assertEqual(out["chunks"], 12)
        self.assertEqual(out["corpus"], self.corpus)

    def test_debounce(self):
        self.idx.index_dir(self.corpus, realpath=lambda p: p)
        self.clock["t"] += 1.0  # 1s < 5000ms
        out = self.idx.index_dir(self.corpus, realpath=lambda p: p)
        self.assertTrue(out.get("debounced"))
        self.assertEqual(len(self.calls), 1)

    def test_watch_registry(self):
        self.idx.index_dir(self.corpus, watch=True, realpath=lambda p: p)
        self.assertIn(self.corpus, self.idx.pending_paths())

    def test_path_denied(self):
        with self.assertRaises(PermissionDenied):
            self.idx.index_dir("/etc/passwd", realpath=lambda p: p)


if __name__ == "__main__":
    unittest.main()
