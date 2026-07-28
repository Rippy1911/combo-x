"""Invoke ns-rag ingest CLI (debounced). FSEvents watch wiring is a follow-up."""

from __future__ import annotations

import os
import re
import subprocess
import time
from typing import Any, Callable, Dict, Optional, Set

from jarvisd.config import expand
from jarvisd.safety import check_path


class Indexer:
    def __init__(self, config: dict, runner: Callable = subprocess.run, clock=time.time):
        self.config = config
        self.runner = runner
        self.clock = clock
        self._last_run: Dict[str, float] = {}
        self._watched: Set[str] = set()

    def pending_paths(self) -> list:
        return sorted(self._watched)

    def index_dir(
        self,
        path: str,
        watch: bool = False,
        home: Optional[str] = None,
        realpath=os.path.realpath,
    ) -> Dict[str, Any]:
        roots = self.config.get("roots") or []
        resolved = check_path(path, roots, home=home, realpath=realpath)

        if watch:
            self._watched.add(resolved)

        idx = self.config.get("indexer") or {}
        debounce_ms = int(idx.get("debounceMs") or 5000)
        now = self.clock()
        last = self._last_run.get(resolved)
        if last is not None and (now - last) * 1000.0 < debounce_ms:
            # Debounced: return last-known-ish stub counts
            return {
                "files": 0,
                "chunks": 0,
                "corpus": resolved,
                "debounced": True,
            }

        ns_rag = expand(idx.get("nsRagDir") or "~/projects/base44/ns-rag", home=home)
        env = os.environ.copy()
        env["NS_RAG_CORPUS"] = resolved

        proc = self.runner(
            ["npm", "run", "ingest"],
            cwd=ns_rag,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self._last_run[resolved] = now

        stdout = (proc.stdout or "") + "\n" + (proc.stderr or "")
        files, chunks = _parse_ingest_counts(stdout)
        return {"files": files, "chunks": chunks, "corpus": resolved}


def _parse_ingest_counts(stdout: str) -> tuple:
    """Parse ns-rag ingest.mjs stdout for file/chunk counts."""
    files = 0
    chunks = 0
    m = re.search(r"corpus:\s*(\d+)\s*files", stdout)
    if m:
        files = int(m.group(1))
    m2 = re.search(r"DONE:\s*(\d+)\s*files,\s*(\d+)\s*chunks", stdout)
    if m2:
        files = int(m2.group(1))
        chunks = int(m2.group(2))
    else:
        m3 = re.search(r"(\d+)\s*chunks parsed", stdout)
        if m3:
            chunks = int(m3.group(1))
    return files, chunks


def index_dir(
    path: str,
    config: dict,
    runner: Callable = subprocess.run,
    watch: bool = False,
    **kwargs,
) -> Dict[str, Any]:
    """Module-level helper used by tests / thin callers."""
    return Indexer(config, runner=runner).index_dir(path, watch=watch, **kwargs)
