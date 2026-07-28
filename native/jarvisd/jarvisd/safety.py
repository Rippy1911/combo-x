"""Deny-by-default security boundary for jarvisd."""

from __future__ import annotations

import os
import re
from typing import Callable, Optional, Sequence

from jarvisd.errors import PermissionDenied

SENSITIVE_BUNDLE_IDS = frozenset(
    {
        "com.1password.1password",
        "com.agilebits.onepassword7",
        "com.apple.keychainaccess",
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "dev.warp.Warp-Stable",
        "com.apple.Passwords",
        "com.bitwarden.desktop",
        "com.lastpass.LastPass",
        "org.keepassxc.keepassxc",
        "com.apple.systempreferences",
    }
)

SENSITIVE_NAME_PATTERNS = [
    re.compile(r"\b(bank|banking|mBank|ING|Revolut|PKO)\b", re.I),
    re.compile(r"password", re.I),
    re.compile(r"keychain", re.I),
    re.compile(r"terminal", re.I),
    re.compile(r"iterm", re.I),
    re.compile(r"1password", re.I),
    re.compile(r"wallet", re.I),
]

_BUNDLE_SET = {b.lower() for b in SENSITIVE_BUNDLE_IDS}


def is_sensitive_app(name: Optional[str], bundle_id: Optional[str] = None) -> bool:
    bid = (bundle_id or "").strip()
    if bid and bid.lower() in _BUNDLE_SET:
        return True
    n = (name or "").strip()
    if n:
        for pat in SENSITIVE_NAME_PATTERNS:
            if pat.search(n):
                return True
    return False


def assert_capture_allowed(app) -> None:
    name, bid = _app_parts(app)
    if is_sensitive_app(name, bid):
        raise PermissionDenied("denied:sensitive_app")


def assert_input_allowed(app) -> None:
    name, bid = _app_parts(app)
    if is_sensitive_app(name, bid):
        raise PermissionDenied("denied:sensitive_app")


def assert_typing_target(app) -> None:
    name, bid = _app_parts(app)
    if not (name or "").strip() and not (bid or "").strip():
        raise PermissionDenied("denied:typing_target")
    if is_sensitive_app(name, bid):
        raise PermissionDenied("denied:sensitive_app")


def is_secure_field(role: Optional[str]) -> bool:
    if not role:
        return False
    r = role.strip()
    if r == "AXSecureTextField" or r == "AXSecureTextArea":
        return True
    return "securetextfield" in r.lower()


def assert_not_secure_field(role: Optional[str]) -> None:
    if is_secure_field(role):
        raise PermissionDenied("denied:secure_field")


def _app_parts(app):
    if app is None:
        return None, None
    if isinstance(app, str):
        return app, None
    if isinstance(app, dict):
        return app.get("name"), app.get("bundleId") or app.get("bundle_id")
    name = getattr(app, "name", None) or getattr(app, "app", None)
    bid = getattr(app, "bundleId", None) or getattr(app, "bundle_id", None)
    return name, bid


def _normalize_path_string(path: str) -> Optional[str]:
    if not path.startswith("/"):
        return None
    parts = path.split("/")
    out = []
    for part in parts:
        if part == "" or part == ".":
            continue
        if part == "..":
            if not out:
                return None
            out.pop()
            continue
        if "\0" in part:
            return None
        out.append(part)
    return "/" + "/".join(out)


def _path_inside_root(normalized: str, root: str) -> bool:
    return normalized == root or normalized.startswith(root + "/")


def check_path(
    path: str,
    roots: Sequence[str],
    home: Optional[str] = None,
    realpath: Callable[[str], str] = os.path.realpath,
) -> str:
    """Return normalized absolute path inside an allowlisted root, or raise."""
    if path is None or str(path).strip() == "":
        raise PermissionDenied("denied:path")
    if "\0" in path:
        raise PermissionDenied("denied:path")

    home_dir = home if home is not None else os.path.expanduser("~")

    expanded = path
    if path == "~" or path.startswith("~/"):
        if not home_dir:
            raise PermissionDenied("denied:path")
        expanded = home_dir if path == "~" else home_dir + path[1:]

    if not expanded.startswith("/"):
        raise PermissionDenied("denied:path")

    normalized = _normalize_path_string(expanded)
    if not normalized:
        raise PermissionDenied("denied:path")

    try:
        resolved = realpath(normalized)
    except OSError as exc:
        raise PermissionDenied("denied:path") from exc

    if "\0" in resolved:
        raise PermissionDenied("denied:path")
    resolved_norm = _normalize_path_string(resolved) or resolved

    expanded_roots = []
    for root in roots:
        r = root
        if r == "~" or (isinstance(r, str) and r.startswith("~/")):
            if not home_dir:
                continue
            r = home_dir if r == "~" else home_dir + r[1:]
        nr = _normalize_path_string(r)
        if nr:
            try:
                expanded_roots.append(_normalize_path_string(realpath(nr)) or realpath(nr))
            except OSError:
                expanded_roots.append(nr)

    for root in expanded_roots:
        if _path_inside_root(resolved_norm, root):
            return resolved_norm

    raise PermissionDenied("denied:path")
