"""files.list_dir / read_file with tempfile fixtures."""

import os
import tempfile
import unittest

from jarvisd.errors import BadRequest, PermissionDenied
from jarvisd.files import list_dir, read_file


class TestFiles(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = self.td.name
        os.makedirs(os.path.join(self.root, "node_modules", "pkg"))
        os.makedirs(os.path.join(self.root, ".git"))
        os.makedirs(os.path.join(self.root, "src"))
        with open(os.path.join(self.root, "readme.md"), "w", encoding="utf-8") as f:
            f.write("hello " * 100)
        with open(os.path.join(self.root, "bin.dat"), "wb") as f:
            f.write(b"\x00\x01\x02\xff binary")
        self.roots = [self.root]

    def tearDown(self):
        self.td.cleanup()

    def test_skip_dirs(self):
        out = list_dir(self.root, self.roots, limit=200)
        names = {e["name"] for e in out["entries"]}
        self.assertIn("readme.md", names)
        self.assertIn("src", names)
        self.assertNotIn("node_modules", names)
        self.assertNotIn(".git", names)

    def test_read_truncation(self):
        out = read_file(
            os.path.join(self.root, "readme.md"),
            self.roots,
            max_chars=10,
        )
        self.assertTrue(out["truncated"])
        self.assertEqual(len(out["text"]), 10)

    def test_binary_refusal(self):
        with self.assertRaises(BadRequest) as ctx:
            read_file(os.path.join(self.root, "bin.dat"), self.roots)
        self.assertEqual(ctx.exception.code, "bad_request:binary")

    def test_path_denied(self):
        with self.assertRaises(PermissionDenied):
            list_dir("/etc", self.roots)


if __name__ == "__main__":
    unittest.main()
