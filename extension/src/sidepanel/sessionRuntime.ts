import type { ChatMessage, LlmUsage } from "@combo-x/core";

/** Drop idle background session workspaces after this (not running, not open). */
export const SESSION_IDLE_EVICT_MS = 5 * 60 * 1000;

export type SessionUsageSplit = {
  total: LlmUsage;
  orch: LlmUsage;
  worker: LlmUsage;
};

/** Lightweight UI turn shape — kept loose to avoid circular imports with App. */
export type RuntimeTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  bookmarked?: boolean;
  [key: string]: unknown;
};

export type SessionRuntime = {
  sessionId: string;
  turns: RuntimeTurn[];
  history: ChatMessage[];
  running: boolean;
  status: string;
  streamingId: string | null;
  /** Opaque id for the in-flight send(); finally must match before clearing. */
  activeRunId: string | null;
  sessionUsage: SessionUsageSplit;
  lastTurnUsage: SessionUsageSplit | null;
  unlockedThisRun: string[];
  /** Epoch ms — touch on switch / send / event. */
  lastTouchedAt: number;
  /** Assistant finished (or needs attention) while this chat was not open. */
  unread: boolean;
};

export type SessionRuntimeMeta = {
  sessionId: string;
  running: boolean;
  unread: boolean;
  status: string;
};

export function emptyUsageSplit(zero: LlmUsage): SessionUsageSplit {
  return { total: { ...zero }, orch: { ...zero }, worker: { ...zero } };
}

export function createEmptyRuntime(
  sessionId: string,
  zero: LlmUsage,
): SessionRuntime {
  return {
    sessionId,
    turns: [],
    history: [],
    running: false,
    status: "",
    streamingId: null,
    activeRunId: null,
    sessionUsage: emptyUsageSplit(zero),
    lastTurnUsage: null,
    unlockedThisRun: [],
    lastTouchedAt: Date.now(),
    unread: false,
  };
}

export function metaFromRuntimes(map: Map<string, SessionRuntime>): SessionRuntimeMeta[] {
  return [...map.values()].map((r) => ({
    sessionId: r.sessionId,
    running: r.running,
    unread: r.unread,
    status: r.status,
  }));
}

/** Evict idle, non-running, non-active workspaces from memory (IDB untouched). */
export function evictIdleRuntimes(
  map: Map<string, SessionRuntime>,
  activeSessionId: string | null | undefined,
  now = Date.now(),
  idleMs = SESSION_IDLE_EVICT_MS,
): string[] {
  const removed: string[] = [];
  for (const [id, rt] of map) {
    if (rt.running) continue;
    if (activeSessionId && id === activeSessionId) continue;
    if (now - rt.lastTouchedAt < idleMs) continue;
    map.delete(id);
    removed.push(id);
  }
  return removed;
}
