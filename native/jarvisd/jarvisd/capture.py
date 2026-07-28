"""Screenshots via Quartz CGWindowList or screencapture CLI fallback."""

from __future__ import annotations

import base64
import os
import subprocess
import tempfile
from typing import Any, Callable, Dict, Optional

from jarvisd.errors import BadRequest, PermissionDenied, Unavailable
from jarvisd import safety


def _png_data_url(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def _is_mostly_black(png_bytes: bytes) -> bool:
    """Heuristic: tiny or all-zero-ish payloads imply missing Screen Recording."""
    if not png_bytes or len(png_bytes) < 64:
        return True
    # PNG with almost no variance often means black permission placeholder.
    # Keep this conservative — only flag empty/near-empty.
    return False


def _downscale_png(png_bytes: bytes, max_width: int) -> tuple:
    """Downscale using AppKit if available; otherwise return unchanged."""
    try:
        from AppKit import NSBitmapImageRep, NSImage  # type: ignore
        from Foundation import NSData  # type: ignore

        data = NSData.dataWithBytes_length_(png_bytes, len(png_bytes))
        img = NSImage.alloc().initWithData_(data)
        if img is None:
            return png_bytes, None, None
        size = img.size()
        w, h = float(size.width), float(size.height)
        if w <= max_width or max_width <= 0:
            return png_bytes, int(w), int(h)
        scale = max_width / w
        new_w = int(max_width)
        new_h = max(1, int(h * scale))
        img.setSize_((new_w, new_h))
        rep = NSBitmapImageRep.imageRepWithData_(img.TIFFRepresentation())
        out = rep.representationUsingType_properties_(4, None)  # NSPNGFileType
        raw = bytes(out)
        return raw, new_w, new_h
    except Exception:  # noqa: BLE001
        return png_bytes, None, None


def _screencapture_cli(
    mode: str,
    window_id: Optional[int] = None,
    display_id: Optional[int] = None,
) -> bytes:
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        cmd = ["screencapture", "-x"]
        if mode == "window" and window_id is not None:
            cmd.extend(["-l", str(window_id)])
        elif mode == "display" and display_id is not None:
            cmd.extend(["-D", str(display_id)])
        cmd.append(path)
        # Bound wait so a TCC prompt never hangs the native-messaging loop.
        subprocess.run(cmd, check=False, capture_output=True, timeout=15)
        with open(path, "rb") as f:
            return f.read()
    except subprocess.TimeoutExpired as exc:
        raise Unavailable(
            "unavailable:screen_recording",
            hint=(
                "screencapture timed out — grant Screen Recording "
                "(System Settings → Privacy & Security → Screen Recording) "
                "to the jarvisd host process, then relaunch Chrome."
            ),
        ) from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _quartz_capture(
    mode: str,
    app: Optional[str] = None,
    display_id: Optional[int] = None,
) -> tuple:
    """Return (png_bytes, width, height) using Quartz. Raises on failure."""
    import Quartz  # type: ignore

    if mode == "window" and app:
        opts = (
            Quartz.kCGWindowListOptionOnScreenOnly
            | Quartz.kCGWindowListExcludeDesktopElements
        )
        window_list = Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID)
        target = None
        needle = app.strip().lower()
        for info in window_list or []:
            owner = str(info.get(Quartz.kCGWindowOwnerName, "") or "")
            bid = str(info.get("kCGWindowOwnerBundleID", "") or "")
            if needle in owner.lower() or needle == bid.lower():
                if safety.is_sensitive_app(owner, bid or None):
                    raise PermissionDenied("denied:sensitive_app")
                target = info
                break
        if target is None:
            raise BadRequest("bad_request:no_such_window")
        wid = int(target[Quartz.kCGWindowNumber])
        image = Quartz.CGWindowListCreateImage(
            Quartz.CGRectNull,
            Quartz.kCGWindowListOptionIncludingWindow,
            wid,
            Quartz.kCGWindowImageBoundsIgnoreFraming,
        )
    else:
        # Full display / main display
        image = Quartz.CGWindowListCreateImage(
            Quartz.CGRectInfinite,
            Quartz.kCGWindowListOptionOnScreenOnly,
            Quartz.kCGNullWindowID,
            Quartz.kCGWindowImageDefault,
        )

    _SR_HINT = (
        "Grant Screen Recording to the jarvisd host process "
        "(System Settings → Privacy & Security → Screen Recording → "
        "enable run-jarvisd.sh or the venv python3), then quit Chrome fully "
        "and reopen so the native host relaunches."
    )

    if image is None:
        raise Unavailable("unavailable:screen_recording", hint=_SR_HINT)

    w = int(Quartz.CGImageGetWidth(image))
    h = int(Quartz.CGImageGetHeight(image))
    if w == 0 or h == 0:
        raise Unavailable("unavailable:screen_recording", hint=_SR_HINT)

    from AppKit import NSBitmapImageRep  # type: ignore

    rep = NSBitmapImageRep.alloc().initWithCGImage_(image)
    data = rep.representationUsingType_properties_(4, None)  # PNG
    if data is None:
        raise Unavailable("unavailable:screen_recording", hint=_SR_HINT)
    return bytes(data), w, h


def screenshot(
    mode: str = "display",
    app: Optional[str] = None,
    display_id: Optional[int] = None,
    max_width: Optional[int] = None,
    capture_fn: Optional[Callable[..., tuple]] = None,
    cli_fn: Optional[Callable[..., bytes]] = None,
) -> Dict[str, Any]:
    """Capture screen/window; return ``{dataUrl, width, height}``."""
    if mode not in ("display", "window"):
        raise BadRequest("bad_request:mode")

    if app and safety.is_sensitive_app(app, None):
        raise PermissionDenied("denied:sensitive_app")

    png_bytes = None
    width = height = None

    if capture_fn is not None:
        png_bytes, width, height = capture_fn(
            mode=mode, app=app, display_id=display_id
        )
    else:
        try:
            png_bytes, width, height = _quartz_capture(mode, app=app, display_id=display_id)
        except (ImportError, ModuleNotFoundError):
            fn = cli_fn or _screencapture_cli
            png_bytes = fn(mode=mode, window_id=None, display_id=display_id)
            width = height = None
        except Unavailable:
            raise
        except PermissionDenied:
            raise
        except BadRequest:
            raise
        except Exception:
            fn = cli_fn or _screencapture_cli
            png_bytes = fn(mode=mode, window_id=None, display_id=display_id)
            width = height = None

    if not png_bytes or _is_mostly_black(png_bytes):
        raise Unavailable(
            "unavailable:screen_recording",
            hint=(
                "Grant Screen Recording to the jarvisd host process "
                "(System Settings → Privacy & Security → Screen Recording → "
                "enable run-jarvisd.sh or the venv python3), then quit Chrome fully "
                "and reopen so the native host relaunches."
            ),
        )

    if max_width:
        png_bytes, dw, dh = _downscale_png(png_bytes, int(max_width))
        if dw is not None:
            width, height = dw, dh

    if width is None or height is None:
        # Best-effort: leave unknown dimensions as 0 when CLI path used without AppKit
        width = width or 0
        height = height or 0

    return {
        "dataUrl": _png_data_url(png_bytes),
        "width": int(width),
        "height": int(height),
    }
