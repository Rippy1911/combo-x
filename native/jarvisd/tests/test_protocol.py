"""Protocol framing + Dispatcher error mapping."""

import io
import struct
import unittest

from jarvisd.errors import BadRequest, PermissionDenied, Unavailable
from jarvisd.protocol import Dispatcher, MAX_FRAME, read_message, write_message


class TestFraming(unittest.TestCase):
    def test_round_trip(self):
        buf = io.BytesIO()
        write_message(buf, {"id": "1", "op": "ping", "args": {}})
        buf.seek(0)
        msg = read_message(buf)
        self.assertEqual(msg["id"], "1")
        self.assertEqual(msg["op"], "ping")

    def test_eof(self):
        buf = io.BytesIO(b"")
        self.assertIsNone(read_message(buf))

    def test_oversized_frame_rejected(self):
        n = MAX_FRAME + 1
        buf = io.BytesIO(struct.pack("<I", n) + b"x" * 10)
        with self.assertRaises(BadRequest) as ctx:
            read_message(buf)
        self.assertIn("frame_too_large", ctx.exception.code)


class TestDispatcher(unittest.TestCase):
    def setUp(self):
        self.d = Dispatcher()

    def test_success(self):
        self.d.register("ping", lambda args: {"pong": True})
        r = self.d.handle({"id": "a", "op": "ping", "args": {}})
        self.assertTrue(r["ok"])
        self.assertEqual(r["data"]["pong"], True)

    def test_unknown_op(self):
        r = self.d.handle({"id": "a", "op": "nope", "args": {}})
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "unknown_op:nope")

    def test_missing_id(self):
        r = self.d.handle({"op": "ping"})
        self.assertFalse(r["ok"])
        self.assertIn("missing_id", r["error"])

    def test_permission_denied(self):
        self.d.register("x", lambda a: (_ for _ in ()).throw(PermissionDenied("denied:sensitive_app")))
        r = self.d.handle({"id": "1", "op": "x", "args": {}})
        self.assertEqual(r["error"], "denied:sensitive_app")

    def test_bad_request(self):
        self.d.register("x", lambda a: (_ for _ in ()).throw(BadRequest("bad_request:combo")))
        r = self.d.handle({"id": "1", "op": "x", "args": {}})
        self.assertEqual(r["error"], "bad_request:combo")

    def test_unavailable(self):
        self.d.register("x", lambda a: (_ for _ in ()).throw(Unavailable("unavailable:whisper")))
        r = self.d.handle({"id": "1", "op": "x", "args": {}})
        self.assertEqual(r["error"], "unavailable:whisper")

    def test_internal_does_not_escape(self):
        def boom(args):
            raise RuntimeError("explode")

        self.d.register("x", boom)
        r = self.d.handle({"id": "1", "op": "x", "args": {}})
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "internal:RuntimeError")


if __name__ == "__main__":
    unittest.main()
