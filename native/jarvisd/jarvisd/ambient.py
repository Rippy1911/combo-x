"""Local-only rolling transcript buffer + opt-in diary. No network sinks."""

from __future__ import annotations

import os
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Deque, Dict, List, Optional

from jarvisd.errors import Unavailable


class AmbientBuffer:
    """Rolling ring of ``{at, text}`` pruned by age."""

    def __init__(self, minutes: float = 5.0):
        self.minutes = float(minutes)
        self._items: Deque[Dict[str, Any]] = deque()

    def append(self, text: str, at: Optional[float] = None) -> None:
        ts = at if at is not None else time.time()
        self._items.append({"at": ts, "text": text})
        self._prune()

    def _prune(self, now: Optional[float] = None) -> None:
        cutoff = (now if now is not None else time.time()) - self.minutes * 60.0
        while self._items and self._items[0]["at"] < cutoff:
            self._items.popleft()

    def recall(self, minutes: Optional[float] = None) -> List[Dict[str, Any]]:
        self._prune()
        if minutes is None:
            return list(self._items)
        cutoff = time.time() - float(minutes) * 60.0
        return [s for s in self._items if s["at"] >= cutoff]

    def clear(self) -> None:
        self._items.clear()


class AmbientRecorder:
    """
    When ambient.enabled and whisperBin is set, runs whisper.cpp over short
    audio chunks from an injectable ``chunk_source``. Pauses while a secure
    field has focus (caller supplies ``secure_focused``).
    """

    def __init__(
        self,
        config: dict,
        buffer: Optional[AmbientBuffer] = None,
        chunk_source: Optional[Callable[[], Optional[bytes]]] = None,
        run_fn: Callable = subprocess.run,
        secure_focused: Optional[Callable[[], bool]] = None,
        clock: Callable[[], float] = time.time,
    ):
        self.config = config
        amb = config.get("ambient") or {}
        self.enabled = bool(amb.get("enabled"))
        self.buffer_minutes = float(amb.get("bufferMinutes") or 5)
        self.diary_enabled = bool(amb.get("diaryEnabled"))
        self.diary_dir = amb.get("diaryDir")
        self.whisper_bin = amb.get("whisperBin")
        self.whisper_model = amb.get("whisperModel")
        self.buffer = buffer or AmbientBuffer(self.buffer_minutes)
        self.chunk_source = chunk_source
        self.run_fn = run_fn
        self.secure_focused = secure_focused or (lambda: False)
        self.clock = clock

    def status(self) -> Dict[str, Any]:
        amb = self.config.get("ambient") or {}
        return {
            "enabled": bool(amb.get("enabled")),
            "bufferMinutes": float(amb.get("bufferMinutes") or 5),
            "diaryEnabled": bool(amb.get("diaryEnabled")),
            "model": amb.get("whisperModel"),
        }

    def recall(self, minutes: Optional[float] = None) -> Dict[str, Any]:
        amb = self.config.get("ambient") or {}
        return {
            "segments": self.buffer.recall(minutes),
            "enabled": bool(amb.get("enabled")),
        }

    def ensure_usable(self) -> None:
        if not self.enabled:
            return
        if not self.whisper_bin or not os.path.isfile(str(self.whisper_bin)):
            raise Unavailable("unavailable:whisper")

    def process_once(self) -> Optional[str]:
        """Pull one chunk, transcribe, append. Returns text or None."""
        if not self.enabled:
            return None
        self.ensure_usable()
        if self.secure_focused():
            return None
        if self.chunk_source is None:
            return None
        chunk = self.chunk_source()
        if not chunk:
            return None
        text = self._transcribe(chunk)
        if text:
            self.buffer.append(text, at=self.clock())
            if self.diary_enabled:
                self._append_diary(text)
        return text

    def _transcribe(self, chunk: bytes) -> str:
        import tempfile

        fd, path = tempfile.mkstemp(suffix=".wav")
        try:
            os.write(fd, chunk)
            os.close(fd)
            cmd = [str(self.whisper_bin), "-f", path, "-nt"]
            if self.whisper_model:
                cmd.extend(["-m", str(self.whisper_model)])
            proc = self.run_fn(cmd, capture_output=True, text=True, check=False)
            out = (proc.stdout or "") + (proc.stderr or "")
            return out.strip()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def _append_diary(self, text: str) -> None:
        if not self.diary_enabled:
            return
        if not self.diary_dir:
            return
        from jarvisd.config import expand

        diary = expand(self.diary_dir)
        os.makedirs(diary, exist_ok=True)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = os.path.join(diary, f"{day}.md")
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"- {ts} UTC — {text}\n")

    def write_diary_summary(self, summary: str) -> Optional[str]:
        """Append a daily summary line. Only when diaryEnabled is true."""
        if not self.diary_enabled:
            return None
        self._append_diary(summary)
        return summary
