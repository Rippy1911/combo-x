/**
 * Format open conversation tasks for system-prompt inject (memory-parallel).
 */

import type { Task } from "./store.js";

const DEFAULT_LIMIT = 10;

/** Prefer session-scoped open tasks, then global; skip done. */
export function pickOpenTasksForInject(
  tasks: Task[],
  sessionId?: string,
  limit = DEFAULT_LIMIT,
): Task[] {
  const byRecent = (a: Task, b: Task) => b.updatedAt.localeCompare(a.updatedAt);
  const open = tasks.filter((t) => t.status !== "done");
  const session =
    sessionId != null
      ? open.filter((t) => t.sessionId === sessionId).sort(byRecent)
      : [];
  const global = open.filter((t) => t.sessionId == null).sort(byRecent);
  const merged: Task[] = [];
  const seen = new Set<string>();
  for (const t of [...session, ...global]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push(t);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function formatOpenTasksBlock(
  tasks: Task[],
  sessionId?: string,
  limit = DEFAULT_LIMIT,
): string {
  const open = pickOpenTasksForInject(tasks, sessionId, limit);
  if (!open.length) return "";
  const lines = open.map((t, i) => {
    const note = t.note ? ` — ${t.note.slice(0, 120)}` : "";
    return `${i + 1}. [${t.status}] ${t.title}${note} (${t.id.slice(0, 8)})`;
  });
  return (
    `OPEN CONVERSATION TASKS (this chat + global; update via update_task / create_task — do not invent completion):\n` +
    lines.join("\n")
  );
}
