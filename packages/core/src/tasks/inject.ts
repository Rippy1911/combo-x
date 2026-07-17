/**
 * Format open conversation tasks for system-prompt inject (memory-parallel).
 */

import { compareTasksByOrder, taskProgress, type Task } from "./store.js";

const DEFAULT_LIMIT = 10;

/** Prefer session-scoped open tasks, then global; skip done; respect sortOrder. */
export function pickOpenTasksForInject(
  tasks: Task[],
  sessionId?: string,
  limit = DEFAULT_LIMIT,
): Task[] {
  const open = tasks.filter((t) => t.status !== "done");
  const session =
    sessionId != null
      ? open.filter((t) => t.sessionId === sessionId).sort(compareTasksByOrder)
      : [];
  const global = open.filter((t) => t.sessionId == null).sort(compareTasksByOrder);
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

  // Progress is session-scoped (drawer parity); open list still includes global.
  const progressPool =
    sessionId != null
      ? tasks.filter((t) => t.sessionId === sessionId)
      : tasks.filter((t) => t.sessionId == null);
  const { done, total } = taskProgress(progressPool);

  const lines = open.map((t, i) => {
    const note = t.note ? ` — ${t.note.slice(0, 120)}` : "";
    return `${i + 1}. [${t.status}] ${t.title}${note} (${t.id.slice(0, 8)})`;
  });
  return (
    `CONVERSATION TASKS ${done}/${total} done (this chat + global; update via update_task / create_task / reorder_tasks — do not invent completion):\n` +
    lines.join("\n")
  );
}
