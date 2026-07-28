"""End-to-end Chrome native-messaging framing smoke (subprocess).

Spawns ``python3 -m jarvisd`` the way Chrome does: length-prefixed JSON on
stdin/stdout. Exercises handshake, apps, denylist, path ACL, unknown op,
and malformed frames. TCC-gated ops are attempted and recorded when denied.
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable
ENV = {
    **os.environ,
    "PYTHONPATH": str(ROOT) + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else ""),
}


def _pack(obj: dict) -> bytes:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(raw)) + raw


def _read_one(stream, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    header = b""
    while len(header) < 4:
        if time.time() > deadline:
            raise TimeoutError("timed out waiting for frame header")
        chunk = stream.read(4 - len(header))
        if chunk == b"" and len(header) == 0:
            raise EOFError("daemon closed stdout before response")
        if not chunk:
            time.sleep(0.01)
            continue
        header += chunk
    (n,) = struct.unpack("<I", header)
    body = b""
    while len(body) < n:
        if time.time() > deadline:
            raise TimeoutError("timed out waiting for frame body")
        chunk = stream.read(n - len(body))
        if not chunk:
            time.sleep(0.01)
            continue
        body += chunk
    return json.loads(body.decode("utf-8"))


class NativeHost:
    """Spawn jarvisd with an isolated config; Chrome-style stdio framing."""

    def __init__(self, config: dict):
        self._tmpdir = tempfile.TemporaryDirectory(prefix="jarvisd-e2e-")
        self._cfg_path = Path(self._tmpdir.name) / "config.json"
        self._cfg_path.write_text(json.dumps(config), encoding="utf-8")
        # Monkey-patch via env is not wired — point load_config by cwd trick:
        # Server.load_config uses ~/.config/jarvisd. We inject via JARVISD_CONFIG.
        self.proc = None

    def __enter__(self):
        # Patch: pass config by writing default path override through env if
        # supported; otherwise start with a wrapper that sets config path.
        # jarvisd.main() always load_config() — use a small launcher.
        launcher = Path(self._tmpdir.name) / "launch.py"
        launcher.write_text(
            f"""
import sys
from jarvisd.server import Server
from jarvisd.config import load_config
cfg = load_config({json.dumps(str(self._cfg_path))})
Server(config=cfg).serve_stdio()
""",
            encoding="utf-8",
        )
        self.proc = subprocess.Popen(
            [PYTHON, str(launcher)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(ROOT),
            env=ENV,
        )
        return self

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)
        self._tmpdir.cleanup()

    def request(self, op: str, args=None, req_id: str = "r1", timeout: float = 10.0) -> dict:
        assert self.proc and self.proc.stdin and self.proc.stdout
        msg = {"id": req_id, "op": op, "args": args or {}}
        self.proc.stdin.write(_pack(msg))
        self.proc.stdin.flush()
        return _read_one(self.proc.stdout, timeout=timeout)

    def write_raw(self, data: bytes) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def read_raw(self, timeout: float = 5.0) -> dict:
        assert self.proc and self.proc.stdout
        return _read_one(self.proc.stdout, timeout=timeout)


def _default_config(allow_root: str) -> dict:
    return {
        "roots": [allow_root],
        "ambient": {
            "enabled": False,
            "bufferMinutes": 5,
            "diaryEnabled": False,
            "diaryDir": "~/projects/base44/_memory/jarvis-diary",
            "whisperBin": None,
            "whisperModel": None,
        },
        "indexer": {"nsRagDir": "~/projects/base44/ns-rag", "debounceMs": 5000},
        "micOwner": "offscreen",
    }


class TestNativeFramingE2E(unittest.TestCase):
    def test_chrome_framing_smoke(self):
        allow = tempfile.mkdtemp(prefix="jarvisd-allow-")
        Path(allow, "note.md").write_text("hello from allowlist\n", encoding="utf-8")
        cfg = _default_config(allow)

        with NativeHost(cfg) as host:
            # 1) handshake / mic_owner — matching id
            r = host.request("mic_owner", {}, req_id="handshake-1")
            self.assertEqual(r["id"], "handshake-1")
            self.assertTrue(r["ok"], r)
            self.assertIn(r["data"]["owner"], ("offscreen", "daemon"))

            r = host.request("ping", {}, req_id="ping-1")
            self.assertEqual(r["id"], "ping-1")
            self.assertTrue(r["ok"], r)
            self.assertIn("version", r["data"])
            self.assertIn("pid", r["data"])

            # 2) mac_apps equivalent: apps → running list (no TCC)
            r = host.request("apps", {}, req_id="apps-1")
            self.assertEqual(r["id"], "apps-1")
            self.assertTrue(r["ok"], r)
            apps = r["data"].get("apps") or []
            self.assertIsInstance(apps, list)
            self.assertGreater(len(apps), 0, "expected at least one regular app")
            self.assertIn("name", apps[0])

            # 3) denylisted app — capture + input refused with explicit reason
            r = host.request(
                "screenshot",
                {"mode": "window", "app": "1Password"},
                req_id="deny-shot",
            )
            self.assertEqual(r["id"], "deny-shot")
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "denied:sensitive_app")

            r = host.request("ui_tree", {"app": "Terminal"}, req_id="deny-tree")
            self.assertEqual(r["id"], "deny-tree")
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "denied:sensitive_app")

            r = host.request("focus", {"app": "Keychain Access"}, req_id="deny-focus")
            self.assertEqual(r["id"], "deny-focus")
            self.assertFalse(r["ok"])
            # Either sensitive (if running / name match) or no_such_app
            self.assertIn(
                r["error"],
                ("denied:sensitive_app", "bad_request:no_such_app"),
                r,
            )
            # Banking name pattern — denied before lookup when used as capture target
            r = host.request(
                "screenshot",
                {"mode": "window", "app": "mBank Online"},
                req_id="deny-bank",
            )
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "denied:sensitive_app")

            # 4) path outside allowlisted roots → REFUSED
            r = host.request("read_file", {"path": "/etc/passwd"}, req_id="deny-read")
            self.assertEqual(r["id"], "deny-read")
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "denied:path")

            r = host.request("list_dir", {"path": "/etc"}, req_id="deny-list")
            self.assertEqual(r["id"], "deny-list")
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "denied:path")

            # Allowlisted read still works
            r = host.request(
                "read_file",
                {"path": str(Path(allow) / "note.md")},
                req_id="ok-read",
            )
            self.assertTrue(r["ok"], r)
            self.assertIn("hello", r["data"]["text"])

            # 5) unknown op → structured error; daemon stays alive
            r = host.request("definitely_not_an_op", {}, req_id="unk-1")
            self.assertEqual(r["id"], "unk-1")
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "unknown_op:definitely_not_an_op")

            r = host.request("ping", {}, req_id="alive-after-unk")
            self.assertTrue(r["ok"], r)
            self.assertEqual(r["id"], "alive-after-unk")

            # 6) malformed JSON frame (valid length) → error response, loop continues
            bad = b"{not-json"
            host.write_raw(struct.pack("<I", len(bad)) + bad)
            r = host.read_raw(timeout=5.0)
            self.assertFalse(r["ok"])
            self.assertIn("invalid_json", r["error"])

            r = host.request("ping", {}, req_id="alive-after-bad-json")
            self.assertTrue(r["ok"], r)
            self.assertEqual(r["id"], "alive-after-bad-json")

            # Truncated frame → daemon exits the loop cleanly (no crash / hang)
            host.write_raw(struct.pack("<I", 100) + b"short")  # claims 100, sends 5
            # Close stdin so any remaining read completes
            host.proc.stdin.close()
            try:
                code = host.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                host.proc.kill()
                self.fail("daemon hung after truncated frame")
            self.assertEqual(code, 0, f"expected clean exit, got {code}; stderr={host.proc.stderr.read()}")

    def test_tcc_ops_structured_errors(self):
        """Attempt AX / input ops; record Blocked-on-TCC (do not fake green)."""
        allow = tempfile.mkdtemp(prefix="jarvisd-tcc-")
        cfg = _default_config(allow)
        results = {}
        with NativeHost(cfg) as host:
            for op, args, rid in [
                ("ui_tree", {"app": "Finder", "maxNodes": 5}, "tcc-tree"),
                ("click", {"point": {"x": 5, "y": 5}}, "tcc-click"),
                ("type", {"text": "x"}, "tcc-type"),
                ("key", {"combo": "escape"}, "tcc-key"),
                ("screenshot", {"mode": "display", "maxWidth": 320}, "tcc-shot"),
            ]:
                r = host.request(op, args, req_id=rid, timeout=20.0)
                results[op] = r
                self.assertEqual(r["id"], rid)
                # Must not crash / hang — already timed; response must be structured
                self.assertIn("ok", r)
                if not r["ok"]:
                    self.assertIn("error", r)
                    if r["error"].startswith("unavailable:"):
                        # Prefer actionable hint when TCC is the cause
                        self.assertTrue(
                            "hint" in r or r["error"] in (
                                "unavailable:accessibility",
                                "unavailable:screen_recording",
                            ),
                            r,
                        )

        # Persist probe notes for EVIDENCE.md consumers (stderr only)
        for op, r in results.items():
            sys.stderr.write(f"TCC_PROBE {op} → {json.dumps(r, ensure_ascii=False)[:300]}\n")


if __name__ == "__main__":
    unittest.main()
