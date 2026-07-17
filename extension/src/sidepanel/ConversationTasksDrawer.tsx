import {
  TaskStore,
  taskProgress,
  type Task,
  type TaskStatus,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";

const OPEN_STATUSES: TaskStatus[] = ["todo", "doing", "blocked"];

export function ConversationTasksDrawer({
  open,
  onClose,
  taskStore,
  sessionId,
  refreshTick = 0,
}: {
  open: boolean;
  onClose: () => void;
  taskStore: TaskStore;
  sessionId?: string | null;
  /** Bump when agent mutates tasks so the drawer refreshes. */
  refreshTick?: number;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      return;
    }
    setTasks(await taskStore.list({ sessionId }));
  }, [sessionId, taskStore]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh, refreshTick]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "done"),
    [tasks],
  );
  const doneTasks = useMemo(
    () => tasks.filter((t) => t.status === "done"),
    [tasks],
  );
  const { done, total } = taskProgress(tasks);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const createTask = async () => {
    const t = title.trim();
    if (!t || !sessionId) return;
    await taskStore.put({
      id: crypto.randomUUID(),
      title: t,
      status: "todo",
      sessionId,
    });
    setTitle("");
    setMsg("Task created");
    await refresh();
  };

  const moveOpen = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = openTasks.map((t) => t.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    await taskStore.reorder([...ids, ...doneTasks.map((t) => t.id)]);
    await refresh();
  };

  if (!open) return null;

  return (
    <div className="sessions-drawer-root tasks-drawer-root" role="dialog" aria-label="Conversation tasks">
      <button type="button" className="sessions-drawer-backdrop" aria-label="Close" onClick={onClose} />
      <aside className="sessions-drawer tasks-drawer">
        <div className="sessions-drawer-head">
          <h2>Conversation Tasks</h2>
          <div className="row">
            <button type="button" className="msg-action" onClick={() => void refresh()}>
              Refresh
            </button>
            <button type="button" className="msg-action" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="hint wrap">
          Checklist for this chat. Agent sees open items each turn (ordered). Global backlog lives under
          the Tasks tab.
        </p>

        {!sessionId ? (
          <p className="hint">No active session.</p>
        ) : (
          <>
            <div className="task-progress">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="hint">
                  {done}/{total} done{total ? ` (${pct}%)` : ""}
                </span>
              </div>
              <div className="task-progress-bar" aria-hidden>
                <div className="task-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="row task-create">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New task for this chat…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createTask();
                }}
              />
              <button
                type="button"
                className="primary"
                disabled={!title.trim()}
                onClick={() => void createTask()}
              >
                Add
              </button>
            </div>
            {msg ? <p className="hint">{msg}</p> : null}

            <div className="task-list conv-task-list">
              {openTasks.length === 0 ? (
                <p className="hint">No open tasks — add one or ask the agent to plan with create_task.</p>
              ) : (
                openTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`conv-task-row${dragId === task.id ? " dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId) void moveOpen(dragId, task.id);
                      setDragId(null);
                    }}
                  >
                    <span className="task-drag-handle" title="Drag to reorder" aria-hidden>
                      ⋮⋮
                    </span>
                    <span
                      className={`task-dot status-${task.status}`}
                      title={task.status}
                      aria-label={task.status}
                    />
                    <div className="grow conv-task-main">
                      {editingId === task.id ? (
                        <input
                          className="conv-task-edit"
                          value={editDraft}
                          autoFocus
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void (async () => {
                                const next = editDraft.trim();
                                if (next) {
                                  await taskStore.put({ ...task, title: next });
                                  setEditingId(null);
                                  await refresh();
                                }
                              })();
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() =>
                            void (async () => {
                              const next = editDraft.trim();
                              if (next && next !== task.title) {
                                await taskStore.put({ ...task, title: next });
                                await refresh();
                              }
                              setEditingId(null);
                            })()
                          }
                        />
                      ) : (
                        <strong className="task-title">{task.title}</strong>
                      )}
                      {task.note ? <div className="hint wrap task-note">{task.note}</div> : null}
                      <div className="task-status-row">
                        {OPEN_STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`task-status-btn${task.status === s ? " active" : ""}`}
                            onClick={() =>
                              void (async () => {
                                await taskStore.setStatus(task.id, s);
                                await refresh();
                              })()
                            }
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="task-status-btn"
                          onClick={() =>
                            void (async () => {
                              await taskStore.setStatus(task.id, "done");
                              await refresh();
                            })()
                          }
                        >
                          done
                        </button>
                      </div>
                    </div>
                    <div className="conv-task-actions">
                      <button
                        type="button"
                        className="msg-action icon-btn"
                        title="Edit title"
                        aria-label="Edit title"
                        onClick={() => {
                          setEditingId(task.id);
                          setEditDraft(task.title);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="msg-action icon-btn dangerish"
                        title="Delete"
                        aria-label="Delete"
                        onClick={() =>
                          void (async () => {
                            if (!confirm(`Delete “${task.title}”?`)) return;
                            await taskStore.remove(task.id);
                            await refresh();
                          })()
                        }
                      >
                        ⌫
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {doneTasks.length > 0 ? (
              <section className="conv-task-done">
                <h3>DONE ({doneTasks.length})</h3>
                <ul className="list conv-task-done-list">
                  {doneTasks.map((task) => (
                    <li key={task.id} className="conv-task-done-row">
                      <span className="task-dot status-done" aria-hidden />
                      <span className="task-title done">{task.title}</span>
                      <button
                        type="button"
                        className="msg-action"
                        onClick={() =>
                          void (async () => {
                            await taskStore.setStatus(task.id, "todo");
                            await refresh();
                          })()
                        }
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        className="msg-action dangerish"
                        onClick={() =>
                          void (async () => {
                            if (!confirm(`Delete “${task.title}”?`)) return;
                            await taskStore.remove(task.id);
                            await refresh();
                          })()
                        }
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}
