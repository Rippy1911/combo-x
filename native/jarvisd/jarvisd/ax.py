"""Accessibility UI tree walk + index resolution."""

from __future__ import annotations

from collections import deque
from typing import Any, Dict, List, Optional, Protocol

from jarvisd.errors import BadRequest, PermissionDenied, Unavailable
from jarvisd import safety

ACTIONABLE_ROLES = frozenset(
    {
        "AXButton",
        "AXTextField",
        "AXSecureTextField",
        "AXCheckBox",
        "AXRadioButton",
        "AXLink",
        "AXMenuItem",
        "AXPopUpButton",
        "AXTabGroup",
        "AXComboBox",
        "AXSlider",
        "AXIncrementor",
        "AXDisclosureTriangle",
    }
)


class AxBackend(Protocol):
    def is_trusted(self) -> bool: ...
    def list_apps(self) -> List[Dict[str, Any]]: ...
    def children(self, element: Any) -> List[Any]: ...
    def attrs(self, element: Any) -> Dict[str, Any]: ...
    def root_for_pid(self, pid: int) -> Any: ...


class FakeAxBackend:
    """Test double — supply a prebuilt node forest via ``forest``."""

    def __init__(
        self,
        forest: Optional[List[Dict[str, Any]]] = None,
        trusted: bool = True,
        apps: Optional[List[Dict[str, Any]]] = None,
    ):
        self.trusted = trusted
        self.forest = forest or []
        self.apps = apps or []

    def is_trusted(self) -> bool:
        return self.trusted

    def list_apps(self) -> List[Dict[str, Any]]:
        return list(self.apps)

    def root_for_pid(self, pid: int) -> Any:
        for app in self.apps:
            if app.get("pid") == pid:
                return {"_pid": pid, "_children": self.forest, "role": "AXApplication"}
        return {"_pid": pid, "_children": self.forest, "role": "AXApplication"}

    def children(self, element: Any) -> List[Any]:
        return list(element.get("_children") or [])

    def attrs(self, element: Any) -> Dict[str, Any]:
        if "role" in element and element.get("role") != "AXApplication":
            return {
                "role": element.get("role"),
                "title": element.get("title"),
                "value": element.get("value"),
                "enabled": element.get("enabled", True),
                "focused": element.get("focused", False),
                "frame": element.get("frame") or {"x": 0, "y": 0, "w": 0, "h": 0},
                "actions": element.get("actions") or [],
            }
        return {
            "role": element.get("role", "AXApplication"),
            "title": element.get("title"),
            "value": None,
            "enabled": True,
            "focused": False,
            "frame": {"x": 0, "y": 0, "w": 0, "h": 0},
            "actions": [],
        }


class PyObjCAxBackend:
    """Real macOS Accessibility backend — lazy pyobjc imports."""

    def is_trusted(self) -> bool:
        from ApplicationServices import AXIsProcessTrusted  # type: ignore

        return bool(AXIsProcessTrusted())

    def list_apps(self) -> List[Dict[str, Any]]:
        from AppKit import NSWorkspace  # type: ignore

        ws = NSWorkspace.sharedWorkspace()
        front = ws.frontmostApplication()
        front_pid = front.processIdentifier() if front else None
        out = []
        for app in ws.runningApplications():
            if app.activationPolicy() != 0:  # NSApplicationActivationPolicyRegular
                continue
            out.append(
                {
                    "name": str(app.localizedName() or ""),
                    "bundleId": str(app.bundleIdentifier() or ""),
                    "pid": int(app.processIdentifier()),
                    "frontmost": int(app.processIdentifier()) == front_pid,
                }
            )
        return out

    def root_for_pid(self, pid: int) -> Any:
        from ApplicationServices import AXUIElementCreateApplication  # type: ignore

        return AXUIElementCreateApplication(pid)

    def children(self, element: Any) -> List[Any]:
        from ApplicationServices import (  # type: ignore
            AXUIElementCopyAttributeValue,
            kAXChildrenAttribute,
        )

        err, kids = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, None)
        if err != 0 or kids is None:
            return []
        return list(kids)

    def attrs(self, element: Any) -> Dict[str, Any]:
        from ApplicationServices import (  # type: ignore
            AXUIElementCopyAttributeValue,
            AXUIElementCopyActionNames,
            kAXRoleAttribute,
            kAXTitleAttribute,
            kAXValueAttribute,
            kAXEnabledAttribute,
            kAXFocusedAttribute,
            kAXPositionAttribute,
            kAXSizeAttribute,
        )

        def _copy(attr):
            err, val = AXUIElementCopyAttributeValue(element, attr, None)
            return val if err == 0 else None

        role = _copy(kAXRoleAttribute)
        title = _copy(kAXTitleAttribute)
        value = _copy(kAXValueAttribute)
        enabled = _copy(kAXEnabledAttribute)
        focused = _copy(kAXFocusedAttribute)
        pos = _copy(kAXPositionAttribute)
        size = _copy(kAXSizeAttribute)

        x = y = w = h = 0.0
        try:
            if pos is not None:
                x = float(pos.x)
                y = float(pos.y)
            if size is not None:
                w = float(size.width)
                h = float(size.height)
        except Exception:  # noqa: BLE001
            pass

        actions = []
        try:
            err, names = AXUIElementCopyActionNames(element, None)
            if err == 0 and names:
                actions = list(names)
        except Exception:  # noqa: BLE001
            pass

        return {
            "role": str(role) if role else None,
            "title": str(title) if title is not None else None,
            "value": str(value) if value is not None else None,
            "enabled": bool(enabled) if enabled is not None else True,
            "focused": bool(focused) if focused is not None else False,
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "actions": actions,
        }


def _is_actionable(attrs: Dict[str, Any]) -> bool:
    role = attrs.get("role") or ""
    if role in ACTIONABLE_ROLES:
        return True
    if role == "AXStaticText" and attrs.get("actions"):
        return True
    return False


class UiTree:
    def __init__(self, ax_backend: Optional[AxBackend] = None):
        self.ax_backend = ax_backend
        self._last_nodes: List[Dict[str, Any]] = []

    def _backend(self) -> AxBackend:
        if self.ax_backend is not None:
            return self.ax_backend
        return PyObjCAxBackend()

    def resolve(self, index: int) -> Dict[str, Any]:
        if not self._last_nodes or index < 0 or index >= len(self._last_nodes):
            raise BadRequest("bad_request:stale_index")
        return self._last_nodes[index]

    def walk(
        self,
        app: Optional[str] = None,
        max_nodes: int = 200,
    ) -> Dict[str, Any]:
        # Deny sensitive apps before TCC probe so the refusal reason is explicit.
        if app and safety.is_sensitive_app(app, None):
            raise PermissionDenied("denied:sensitive_app")

        be = self._backend()
        if not be.is_trusted():
            raise Unavailable(
                "unavailable:accessibility",
                hint=(
                    "Grant Accessibility to the jarvisd host process "
                    "(System Settings → Privacy & Security → Accessibility → "
                    "enable run-jarvisd.sh or the venv python3), then quit Chrome fully "
                    "and reopen so the native host relaunches."
                ),
            )

        apps = be.list_apps()
        targets = apps
        if app:
            needle = app.strip().lower()
            targets = [
                a
                for a in apps
                if (a.get("name") or "").lower() == needle
                or (a.get("bundleId") or "").lower() == needle
            ]
            if not targets:
                # Still try name substring
                targets = [
                    a
                    for a in apps
                    if needle in (a.get("name") or "").lower()
                ]
            if not targets:
                raise BadRequest("bad_request:no_such_app")

        nodes: List[Dict[str, Any]] = []
        truncated = False

        for ainfo in targets:
            name = ainfo.get("name") or ""
            bid = ainfo.get("bundleId") or ""
            if safety.is_sensitive_app(name, bid):
                if app:
                    raise PermissionDenied("denied:sensitive_app")
                continue

            root = be.root_for_pid(int(ainfo["pid"]))
            q: deque = deque([root])
            seen = 0
            while q:
                if len(nodes) >= max_nodes:
                    truncated = True
                    break
                el = q.popleft()
                attrs = be.attrs(el)
                role = attrs.get("role")
                if _is_actionable(attrs):
                    node = {
                        "index": len(nodes),
                        "role": role,
                        "title": attrs.get("title"),
                        "value": attrs.get("value"),
                        "enabled": attrs.get("enabled", True),
                        "focused": attrs.get("focused", False),
                        "frame": attrs.get("frame") or {"x": 0, "y": 0, "w": 0, "h": 0},
                        "app": name,
                        "bundleId": bid,
                    }
                    nodes.append(node)
                for child in be.children(el):
                    q.append(child)
                    seen += 1
                    if seen > 50_000:
                        truncated = True
                        break
                if truncated and len(nodes) >= max_nodes:
                    break
            if truncated and len(nodes) >= max_nodes:
                break

        self._last_nodes = nodes
        return {"nodes": nodes, "truncated": truncated}
