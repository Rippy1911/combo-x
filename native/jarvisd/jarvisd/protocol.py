"""Chrome native-messaging framing + request dispatcher."""

from __future__ import annotations

import logging
import struct
import sys
import traceback
from typing import Any, Callable, Dict, Optional

from jarvisd.errors import BadRequest, PermissionDenied, Unavailable

log = logging.getLogger("jarvisd.protocol")

MAX_FRAME = 64 * 1024 * 1024  # 64 MiB

Handler = Callable[[Dict[str, Any]], Dict[str, Any]]


def read_message(stream) -> Optional[dict]:
    """Read one length-prefixed JSON message. None on clean EOF."""
    header = stream.read(4)
    if not header:
        return None
    if len(header) < 4:
        raise BadRequest("bad_request:truncated_frame")
    (n,) = struct.unpack("<I", header)
    if n > MAX_FRAME:
        raise BadRequest("bad_request:frame_too_large")
    body = stream.read(n)
    if len(body) < n:
        raise BadRequest("bad_request:truncated_frame")
    import json

    try:
        obj = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise BadRequest("bad_request:invalid_json") from exc
    if not isinstance(obj, dict):
        raise BadRequest("bad_request:not_object")
    return obj


def write_message(stream, obj: dict) -> None:
    """Write one length-prefixed JSON message to *stream* (stdout protocol)."""
    import json

    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > MAX_FRAME:
        raise BadRequest("bad_request:frame_too_large")
    stream.write(struct.pack("<I", len(raw)))
    stream.write(raw)
    stream.flush()


class Dispatcher:
    """Map ``op`` → handler(args) → data dict; never raises out of ``handle``."""

    def __init__(self) -> None:
        self._handlers: Dict[str, Handler] = {}

    def register(self, op: str, fn: Handler) -> None:
        self._handlers[op] = fn

    def handle(self, request: Any) -> dict:
        if not isinstance(request, dict):
            return {"id": "", "ok": False, "error": "bad_request:not_object"}

        req_id = request.get("id")
        if not isinstance(req_id, str) or req_id == "":
            return {
                "id": req_id if isinstance(req_id, str) else "",
                "ok": False,
                "error": "bad_request:missing_id",
            }

        op = request.get("op")
        if not isinstance(op, str) or op == "":
            return {"id": req_id, "ok": False, "error": "bad_request:missing_op"}

        handler = self._handlers.get(op)
        if handler is None:
            return {"id": req_id, "ok": False, "error": f"unknown_op:{op}"}

        args = request.get("args")
        if args is None:
            args = {}
        if not isinstance(args, dict):
            return {"id": req_id, "ok": False, "error": "bad_request:args"}

        try:
            data = handler(args)
            return {"id": req_id, "ok": True, "data": data if data is not None else {}}
        except PermissionDenied as exc:
            return {"id": req_id, "ok": False, "error": exc.code}
        except BadRequest as exc:
            return {"id": req_id, "ok": False, "error": exc.code}
        except Unavailable as exc:
            out = {"id": req_id, "ok": False, "error": exc.code}
            hint = getattr(exc, "hint", None)
            if hint:
                out["hint"] = hint
            return out
        except Exception as exc:  # noqa: BLE001 — must never escape handle
            tb = traceback.format_exc()
            print(tb, file=sys.stderr)
            log.error("handler %s failed: %s", op, exc)
            return {
                "id": req_id,
                "ok": False,
                "error": f"internal:{type(exc).__name__}",
            }
