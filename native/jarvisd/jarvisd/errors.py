"""Stable protocol error types for jarvisd."""

from __future__ import annotations

from typing import Optional


class JarvisError(Exception):
    """Base error; ``str(self)`` is the wire ``error`` code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class PermissionDenied(JarvisError):
    """Security boundary refusal (denied:*)."""


class BadRequest(JarvisError):
    """Malformed or stale client request (bad_request:*)."""


class Unavailable(JarvisError):
    """Capability missing or not granted (unavailable:*)."""

    def __init__(self, code: str, hint: Optional[str] = None):
        super().__init__(code)
        self.hint = hint
