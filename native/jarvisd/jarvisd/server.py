"""Wire dispatcher to capability handlers; top-level error mapping."""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Dict, Optional

from jarvisd import __version__
from jarvisd.ambient import AmbientRecorder
from jarvisd.apps import focus as focus_app
from jarvisd.apps import running_apps
from jarvisd.ax import UiTree
from jarvisd.capture import screenshot
from jarvisd.config import load_config
from jarvisd.errors import BadRequest, Unavailable
from jarvisd.files import list_dir, read_file
from jarvisd.indexer import Indexer
from jarvisd.input import Input
from jarvisd.protocol import Dispatcher, read_message, write_message

log = logging.getLogger("jarvisd.server")


def _cap_accessibility(tree: UiTree) -> bool:
    try:
        be = tree._backend()
        return bool(be.is_trusted())
    except Exception:  # noqa: BLE001
        return False


def _cap_screen_recording() -> bool:
    # Cannot probe without capturing; report True if Quartz importable.
    try:
        import Quartz  # type: ignore  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        # screencapture CLI may still work
        return os.path.isfile("/usr/sbin/screencapture") or True


def _cap_whisper(cfg: dict) -> bool:
    amb = cfg.get("ambient") or {}
    wb = amb.get("whisperBin")
    return bool(wb and os.path.isfile(str(wb)))


def _cap_indexer(cfg: dict) -> bool:
    from jarvisd.config import expand

    idx = cfg.get("indexer") or {}
    d = expand(idx.get("nsRagDir") or "")
    return bool(d and os.path.isdir(d))


class Server:
    def __init__(
        self,
        config: Optional[dict] = None,
        tree: Optional[UiTree] = None,
        input_ctl: Optional[Input] = None,
        ambient: Optional[AmbientRecorder] = None,
        indexer: Optional[Indexer] = None,
    ):
        self.config = config if config is not None else load_config()
        self.tree = tree or UiTree()
        self.input = input_ctl or Input()
        self.ambient = ambient or AmbientRecorder(self.config)
        self.indexer = indexer or Indexer(self.config)
        self.dispatcher = Dispatcher()
        self._register()

    def _register(self) -> None:
        d = self.dispatcher
        d.register("ping", self.op_ping)
        d.register("ui_tree", self.op_ui_tree)
        d.register("screenshot", self.op_screenshot)
        d.register("click", self.op_click)
        d.register("type", self.op_type)
        d.register("key", self.op_key)
        d.register("apps", self.op_apps)
        d.register("focus", self.op_focus)
        d.register("list_dir", self.op_list_dir)
        d.register("read_file", self.op_read_file)
        d.register("index_dir", self.op_index_dir)
        d.register("ambient_recall", self.op_ambient_recall)
        d.register("ambient_status", self.op_ambient_status)
        d.register("mic_owner", self.op_mic_owner)

    def op_ping(self, args: Dict[str, Any]) -> dict:
        caps = []
        if _cap_accessibility(self.tree):
            caps.append("accessibility")
        if _cap_screen_recording():
            caps.append("screen_recording")
        if _cap_whisper(self.config):
            caps.append("whisper")
        if _cap_indexer(self.config):
            caps.append("indexer")
        return {
            "version": __version__,
            "pid": os.getpid(),
            "capabilities": caps,
        }

    def op_ui_tree(self, args: Dict[str, Any]) -> dict:
        app = args.get("app")
        max_nodes = args.get("maxNodes", 200)
        try:
            max_nodes = int(max_nodes)
        except (TypeError, ValueError) as exc:
            raise BadRequest("bad_request:maxNodes") from exc
        return self.tree.walk(app=app, max_nodes=max_nodes)

    def op_screenshot(self, args: Dict[str, Any]) -> dict:
        mode = args.get("mode") or "display"
        return screenshot(
            mode=mode,
            app=args.get("app"),
            display_id=args.get("displayId"),
            max_width=args.get("maxWidth"),
        )

    def op_click(self, args: Dict[str, Any]) -> dict:
        index = args.get("index")
        point = args.get("point")
        button = args.get("button") or "left"
        double = bool(args.get("double"))
        target = None
        if index is not None:
            target = self.tree.resolve(int(index))
        elif isinstance(point, dict):
            target = point
        else:
            raise BadRequest("bad_request:click_target")
        return self.input.click(target, button=button, double=double)

    def op_type(self, args: Dict[str, Any]) -> dict:
        text = args.get("text")
        if not isinstance(text, str):
            raise BadRequest("bad_request:text")
        node = None
        if args.get("index") is not None:
            node = self.tree.resolve(int(args["index"]))
        return self.input.type_text(text, node=node)

    def op_key(self, args: Dict[str, Any]) -> dict:
        combo = args.get("combo")
        if not isinstance(combo, str):
            raise BadRequest("bad_request:combo")
        return self.input.send_combo(combo)

    def op_apps(self, args: Dict[str, Any]) -> dict:
        return running_apps()

    def op_focus(self, args: Dict[str, Any]) -> dict:
        app = args.get("app")
        if not isinstance(app, str):
            raise BadRequest("bad_request:no_such_app")
        return focus_app(app)

    def op_list_dir(self, args: Dict[str, Any]) -> dict:
        path = args.get("path")
        if not isinstance(path, str):
            raise BadRequest("bad_request:path")
        limit = int(args.get("limit") or 200)
        return list_dir(path, self.config.get("roots") or [], limit=limit)

    def op_read_file(self, args: Dict[str, Any]) -> dict:
        path = args.get("path")
        if not isinstance(path, str):
            raise BadRequest("bad_request:path")
        max_chars = int(args.get("maxChars") or 200_000)
        return read_file(path, self.config.get("roots") or [], max_chars=max_chars)

    def op_index_dir(self, args: Dict[str, Any]) -> dict:
        path = args.get("path")
        if not isinstance(path, str):
            raise BadRequest("bad_request:path")
        watch = bool(args.get("watch"))
        return self.indexer.index_dir(path, watch=watch)

    def op_ambient_recall(self, args: Dict[str, Any]) -> dict:
        minutes = args.get("minutes")
        if minutes is not None:
            minutes = float(minutes)
        return self.ambient.recall(minutes)

    def op_ambient_status(self, args: Dict[str, Any]) -> dict:
        return self.ambient.status()

    def op_mic_owner(self, args: Dict[str, Any]) -> dict:
        owner = self.config.get("micOwner") or "offscreen"
        amb = self.config.get("ambient") or {}
        listening = bool(amb.get("enabled")) and owner == "daemon"
        return {"owner": owner, "listening": listening}

    def handle(self, request: dict) -> dict:
        return self.dispatcher.handle(request)

    def serve_stdio(self, stdin=None, stdout=None) -> None:
        """Native-messaging loop on stdio."""
        inp = stdin if stdin is not None else sys.stdin.buffer
        out = stdout if stdout is not None else sys.stdout.buffer
        while True:
            try:
                msg = read_message(inp)
            except BadRequest as exc:
                # Recoverable framing/JSON errors: answer and keep the loop.
                # Stream-desync cases (truncated / oversized) exit cleanly.
                code = exc.code
                print(f"jarvisd framing error: {code}", file=sys.stderr)
                if code in (
                    "bad_request:invalid_json",
                    "bad_request:not_object",
                ):
                    try:
                        write_message(
                            out,
                            {"id": "", "ok": False, "error": code},
                        )
                    except Exception as write_exc:  # noqa: BLE001
                        print(f"jarvisd write error: {write_exc}", file=sys.stderr)
                        break
                    continue
                break
            except Exception as exc:  # noqa: BLE001
                # Unexpected framing failure — exit without crashing the process
                print(f"jarvisd framing error: {exc}", file=sys.stderr)
                break
            if msg is None:
                break
            resp = self.handle(msg)
            try:
                write_message(out, resp)
            except Exception as exc:  # noqa: BLE001
                print(f"jarvisd write error: {exc}", file=sys.stderr)
                break


def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    cfg = load_config()
    Server(config=cfg).serve_stdio()
