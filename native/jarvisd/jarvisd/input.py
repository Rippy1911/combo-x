"""CGEvent clicks / typing / key combos."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Protocol, Set, Tuple

from jarvisd.errors import BadRequest, PermissionDenied, Unavailable
from jarvisd import safety

_AX_HINT = (
    "Grant Accessibility to the jarvisd host process "
    "(System Settings → Privacy & Security → Accessibility → "
    "enable run-jarvisd.sh or the venv python3), then quit Chrome fully "
    "and reopen so the native host relaunches."
)

MODIFIER_TOKENS: Set[str] = {
    "cmd",
    "command",
    "ctrl",
    "control",
    "alt",
    "option",
    "shift",
    "fn",
}

NAMED_KEYS: Set[str] = {
    "return",
    "enter",
    "tab",
    "space",
    "escape",
    "esc",
    "delete",
    "backspace",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "f10",
    "f11",
    "f12",
}

# macOS virtual keycodes (Carbon HIToolbox)
KEYCODE_MAP = {
    "a": 0,
    "s": 1,
    "d": 2,
    "f": 3,
    "h": 4,
    "g": 5,
    "z": 6,
    "x": 7,
    "c": 8,
    "v": 9,
    "b": 11,
    "q": 12,
    "w": 13,
    "e": 14,
    "r": 15,
    "y": 16,
    "t": 17,
    "1": 18,
    "2": 19,
    "3": 20,
    "4": 21,
    "5": 22,
    "6": 23,
    "7": 26,
    "8": 28,
    "9": 25,
    "0": 29,
    "return": 36,
    "enter": 76,
    "tab": 48,
    "space": 49,
    "delete": 117,
    "backspace": 51,
    "escape": 53,
    "esc": 53,
    "up": 126,
    "down": 125,
    "left": 123,
    "right": 124,
    "home": 115,
    "end": 119,
    "pageup": 116,
    "pagedown": 121,
    "f1": 122,
    "f2": 120,
    "f3": 99,
    "f4": 118,
    "f5": 96,
    "f6": 97,
    "f7": 98,
    "f8": 100,
    "f9": 101,
    "f10": 109,
    "f11": 103,
    "f12": 111,
}

MOD_FLAG = {
    "cmd": 0x100000,  # kCGEventFlagMaskCommand
    "command": 0x100000,
    "shift": 0x20000,
    "alt": 0x80000,
    "option": 0x80000,
    "ctrl": 0x40000,
    "control": 0x40000,
    "fn": 0x800000,
}


def parse_key_combo(combo: str) -> Tuple[list, str]:
    """Parse ``cmd+shift+s`` grammar. Raises BadRequest on invalid."""
    raw = (combo or "").strip()
    if not raw:
        raise BadRequest("bad_request:combo")
    parts = [p.strip() for p in raw.split("+") if p.strip()]
    if not parts:
        raise BadRequest("bad_request:combo")

    modifiers = []
    key = None
    for i, tok in enumerate(parts):
        t = tok.lower()
        is_last = i == len(parts) - 1
        if not is_last:
            if t not in MODIFIER_TOKENS:
                raise BadRequest("bad_request:combo")
            modifiers.append(t)
            continue
        if t in NAMED_KEYS:
            key = t
        elif re.fullmatch(r"[a-z0-9]{1,12}", t, re.I):
            key = t
        else:
            raise BadRequest("bad_request:combo")
    if not key:
        raise BadRequest("bad_request:combo")
    return modifiers, key


class EventBackend(Protocol):
    def frontmost_app(self) -> Dict[str, Any]: ...
    def post_click(self, x: float, y: float, button: str, double: bool) -> None: ...
    def post_unicode(self, text: str) -> None: ...
    def post_key(self, keycode: int, flags: int) -> None: ...


class FakeEventBackend:
    def __init__(self, frontmost: Optional[Dict[str, Any]] = None):
        self.frontmost = frontmost or {"name": "TextEdit", "bundleId": "com.apple.TextEdit"}
        self.events: list = []

    def frontmost_app(self) -> Dict[str, Any]:
        return dict(self.frontmost)

    def post_click(self, x: float, y: float, button: str, double: bool) -> None:
        self.events.append(("click", x, y, button, double))

    def post_unicode(self, text: str) -> None:
        self.events.append(("unicode", text))

    def post_key(self, keycode: int, flags: int) -> None:
        self.events.append(("key", keycode, flags))


class QuartzEventBackend:
    """Real CGEvent backend — lazy Quartz import."""

    def frontmost_app(self) -> Dict[str, Any]:
        from AppKit import NSWorkspace  # type: ignore

        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        if app is None:
            return {"name": "", "bundleId": ""}
        return {
            "name": str(app.localizedName() or ""),
            "bundleId": str(app.bundleIdentifier() or ""),
        }

    def post_click(self, x: float, y: float, button: str, double: bool) -> None:
        import Quartz  # type: ignore

        btn = Quartz.kCGMouseButtonLeft
        down_type = Quartz.kCGEventLeftMouseDown
        up_type = Quartz.kCGEventLeftMouseUp
        if button == "right":
            btn = Quartz.kCGMouseButtonRight
            down_type = Quartz.kCGEventRightMouseDown
            up_type = Quartz.kCGEventRightMouseUp
        elif button == "middle":
            btn = Quartz.kCGMouseButtonCenter
            down_type = Quartz.kCGEventOtherMouseDown
            up_type = Quartz.kCGEventOtherMouseUp

        point = Quartz.CGPointMake(x, y)
        move = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, point, btn)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, move)

        click_count = 2 if double else 1
        for i in range(1, click_count + 1):
            down = Quartz.CGEventCreateMouseEvent(None, down_type, point, btn)
            Quartz.CGEventSetIntegerValueField(down, Quartz.kCGMouseEventClickState, i)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
            up = Quartz.CGEventCreateMouseEvent(None, up_type, point, btn)
            Quartz.CGEventSetIntegerValueField(up, Quartz.kCGMouseEventClickState, i)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)

    def post_unicode(self, text: str) -> None:
        import Quartz  # type: ignore

        # Chunk to stay within CGEventKeyboardSetUnicodeString limits
        chunk_size = 20
        for i in range(0, len(text), chunk_size):
            chunk = text[i : i + chunk_size]
            event = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
            Quartz.CGEventKeyboardSetUnicodeString(event, len(chunk), chunk)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
            up = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
            Quartz.CGEventKeyboardSetUnicodeString(up, len(chunk), chunk)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)

    def post_key(self, keycode: int, flags: int) -> None:
        import Quartz  # type: ignore

        down = Quartz.CGEventCreateKeyboardEvent(None, keycode, True)
        Quartz.CGEventSetFlags(down, flags)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
        up = Quartz.CGEventCreateKeyboardEvent(None, keycode, False)
        Quartz.CGEventSetFlags(up, flags)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)


def _node_center(node: Dict[str, Any]) -> Tuple[float, float]:
    frame = node.get("frame") or {}
    x = float(frame.get("x", 0))
    y = float(frame.get("y", 0))
    w = float(frame.get("w", 0))
    h = float(frame.get("h", 0))
    return x + w / 2.0, y + h / 2.0


class Input:
    def __init__(self, event_backend: Optional[EventBackend] = None):
        self.event_backend = event_backend

    def _backend(self) -> EventBackend:
        if self.event_backend is not None:
            return self.event_backend
        return QuartzEventBackend()

    def _assert_accessibility(self) -> None:
        # Injected backends (unit tests) skip the live TCC probe.
        if self.event_backend is not None:
            return
        try:
            from ApplicationServices import AXIsProcessTrusted  # type: ignore

            trusted = bool(AXIsProcessTrusted())
        except Exception as exc:  # noqa: BLE001
            raise Unavailable("unavailable:accessibility", hint=_AX_HINT) from exc
        if not trusted:
            raise Unavailable("unavailable:accessibility", hint=_AX_HINT)

    def _refuse_sensitive_frontmost(self) -> None:
        front = self._backend().frontmost_app()
        safety.assert_input_allowed(front)

    def click(
        self,
        node_or_point=None,
        button: str = "left",
        double: bool = False,
    ) -> Dict[str, Any]:
        self._assert_accessibility()
        self._refuse_sensitive_frontmost()
        if isinstance(node_or_point, dict) and "frame" in node_or_point:
            safety.assert_input_allowed(
                {"name": node_or_point.get("app"), "bundleId": node_or_point.get("bundleId")}
            )
            x, y = _node_center(node_or_point)
        elif isinstance(node_or_point, dict) and "x" in node_or_point:
            x = float(node_or_point["x"])
            y = float(node_or_point["y"])
        elif isinstance(node_or_point, (tuple, list)) and len(node_or_point) >= 2:
            x, y = float(node_or_point[0]), float(node_or_point[1])
        else:
            raise BadRequest("bad_request:click_target")
        self._backend().post_click(x, y, button or "left", bool(double))
        return {"clicked": True}

    def type_text(self, text: str, node: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self._assert_accessibility()
        self._refuse_sensitive_frontmost()
        if node is not None:
            safety.assert_not_secure_field(node.get("role"))
            safety.assert_typing_target(
                {"name": node.get("app"), "bundleId": node.get("bundleId")}
            )
        if not isinstance(text, str):
            raise BadRequest("bad_request:text")
        self._backend().post_unicode(text)
        return {"typed": True}

    def send_combo(self, combo: str) -> Dict[str, Any]:
        self._assert_accessibility()
        self._refuse_sensitive_frontmost()
        modifiers, key = parse_key_combo(combo)
        flags = 0
        for m in modifiers:
            flags |= MOD_FLAG.get(m, 0)
        keycode = KEYCODE_MAP.get(key.lower())
        if keycode is None and len(key) == 1:
            keycode = KEYCODE_MAP.get(key.lower())
        if keycode is None:
            # Multi-char alphanumeric without a keycode map entry → unicode fallback
            if re.fullmatch(r"[a-z0-9]{1,12}", key, re.I):
                self._backend().post_unicode(key)
                return {"sent": True}
            raise BadRequest("bad_request:combo")
        self._backend().post_key(keycode, flags)
        return {"sent": True}
