"""Allowlisted list_dir / read_file."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Sequence

from jarvisd.errors import BadRequest
from jarvisd.safety import check_path

SKIP_DIR_NAMES = frozenset(
    {"node_modules", ".git", "dist", "build", ".venv", "__pycache__"}
)


def list_dir(
    path: str,
    roots: Sequence[str],
    limit: int = 200,
    home: Optional[str] = None,
    realpath=os.path.realpath,
) -> Dict[str, Any]:
    resolved = check_path(path, roots, home=home, realpath=realpath)
    if not os.path.isdir(resolved):
        raise BadRequest("bad_request:not_a_directory")

    entries: List[Dict[str, Any]] = []
    try:
        names = sorted(os.listdir(resolved))
    except OSError as exc:
        raise BadRequest("bad_request:list_failed") from exc

    for name in names:
        if name in SKIP_DIR_NAMES:
            continue
        full = os.path.join(resolved, name)
        try:
            st = os.stat(full, follow_symlinks=False)
        except OSError:
            continue
        is_dir = os.path.isdir(full)
        if is_dir and name in SKIP_DIR_NAMES:
            continue
        entries.append(
            {
                "name": name,
                "path": full,
                "isDir": is_dir,
                "size": int(st.st_size) if not is_dir else 0,
                "mtime": float(st.st_mtime),
            }
        )
        if len(entries) >= limit:
            break

    return {"entries": entries}


def read_file(
    path: str,
    roots: Sequence[str],
    max_chars: int = 200_000,
    home: Optional[str] = None,
    realpath=os.path.realpath,
) -> Dict[str, Any]:
    resolved = check_path(path, roots, home=home, realpath=realpath)
    if not os.path.isfile(resolved):
        raise BadRequest("bad_request:not_a_file")

    try:
        with open(resolved, "rb") as f:
            raw = f.read(max_chars * 4 + 1)  # bytes upper bound
    except OSError as exc:
        raise BadRequest("bad_request:read_failed") from exc

    # Reject obvious binary (NUL in sample)
    sample = raw[:8192]
    if b"\x00" in sample:
        raise BadRequest("bad_request:binary")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BadRequest("bad_request:binary") from exc

    truncated = False
    if len(text) > max_chars:
        text = text[:max_chars]
        truncated = True
    # If we hit the byte cap, also mark truncated
    if len(raw) > max_chars * 4:
        truncated = True

    return {"path": resolved, "text": text, "truncated": truncated}
