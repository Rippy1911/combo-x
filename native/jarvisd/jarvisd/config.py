"""~/.config/jarvisd/config.json load/save with deep-merge defaults."""

from __future__ import annotations

import copy
import json
import os
from typing import Any, Dict, Optional

DEFAULT_CONFIG: Dict[str, Any] = {
    "roots": ["~/projects", "~/Documents", "~/Downloads", "~/Desktop"],
    "ambient": {
        "enabled": False,
        "bufferMinutes": 5,
        "diaryEnabled": False,
        "diaryDir": "~/projects/base44/_memory/jarvis-diary",
        "whisperBin": None,
        "whisperModel": None,
    },
    "indexer": {
        "nsRagDir": "~/projects/base44/ns-rag",
        "debounceMs": 5000,
    },
    "micOwner": "offscreen",
}


def expand(p: Optional[str], home: Optional[str] = None) -> Optional[str]:
    """Expand leading ``~`` using *home* or ``os.path.expanduser``."""
    if p is None:
        return None
    if not isinstance(p, str):
        return p
    if p == "~" or p.startswith("~/"):
        h = home if home is not None else os.path.expanduser("~")
        if p == "~":
            return h
        return h + p[1:]
    return p


def _deep_merge(base: dict, overlay: dict) -> dict:
    out = copy.deepcopy(base)
    for key, val in overlay.items():
        if (
            key in out
            and isinstance(out[key], dict)
            and isinstance(val, dict)
        ):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = copy.deepcopy(val)
    return out


def default_config_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".config", "jarvisd", "config.json")


def load_config(path: Optional[str] = None) -> dict:
    """Load config, creating defaults on first run. Deep-merges user over defaults."""
    cfg_path = path or default_config_path()
    if not os.path.isfile(cfg_path):
        cfg = copy.deepcopy(DEFAULT_CONFIG)
        save_config(cfg, cfg_path)
        return cfg
    with open(cfg_path, "r", encoding="utf-8") as f:
        try:
            user = json.load(f)
        except json.JSONDecodeError:
            user = {}
    if not isinstance(user, dict):
        user = {}
    return _deep_merge(DEFAULT_CONFIG, user)


def save_config(cfg: dict, path: Optional[str] = None) -> None:
    cfg_path = path or default_config_path()
    parent = os.path.dirname(cfg_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write("\n")
