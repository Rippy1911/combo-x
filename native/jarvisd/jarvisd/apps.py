"""NSWorkspace running apps + focus."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from jarvisd.errors import BadRequest, PermissionDenied
from jarvisd import safety


def running_apps(list_fn: Optional[Callable[[], List[Dict[str, Any]]]] = None) -> Dict[str, Any]:
    if list_fn is not None:
        return {"apps": list_fn()}
    from AppKit import NSWorkspace  # type: ignore

    ws = NSWorkspace.sharedWorkspace()
    front = ws.frontmostApplication()
    front_pid = front.processIdentifier() if front else None
    apps = []
    for app in ws.runningApplications():
        # 0 = NSApplicationActivationPolicyRegular
        if app.activationPolicy() != 0:
            continue
        apps.append(
            {
                "name": str(app.localizedName() or ""),
                "bundleId": str(app.bundleIdentifier() or ""),
                "pid": int(app.processIdentifier()),
                "frontmost": int(app.processIdentifier()) == front_pid,
            }
        )
    return {"apps": apps}


def focus(
    app_name: str,
    list_fn: Optional[Callable[[], List[Dict[str, Any]]]] = None,
    activate_fn: Optional[Callable[[Dict[str, Any]], bool]] = None,
) -> Dict[str, Any]:
    if not app_name or not str(app_name).strip():
        raise BadRequest("bad_request:no_such_app")

    # Refuse denylisted names before lookup so missing apps still get an
    # explicit sensitive-app reason (not only no_such_app).
    if safety.is_sensitive_app(app_name.strip(), None):
        raise PermissionDenied("denied:sensitive_app")

    needle = app_name.strip().lower()
    apps = (list_fn() if list_fn else running_apps()["apps"])

    match = None
    for a in apps:
        name = (a.get("name") or "").lower()
        bid = (a.get("bundleId") or "").lower()
        if name == needle or bid == needle or needle in name:
            match = a
            break

    if match is None:
        raise BadRequest("bad_request:no_such_app")

    safety.assert_input_allowed(match)

    if activate_fn is not None:
        ok = activate_fn(match)
        if not ok:
            raise BadRequest("bad_request:no_such_app")
        return {"focused": True}

    from AppKit import NSRunningApplication, NSApplicationActivateIgnoringOtherApps  # type: ignore

    pid = int(match["pid"])
    app = NSRunningApplication.runningApplicationWithProcessIdentifier_(pid)
    if app is None:
        raise BadRequest("bad_request:no_such_app")
    app.activateWithOptions_(NSApplicationActivateIgnoringOtherApps)
    return {"focused": True}
