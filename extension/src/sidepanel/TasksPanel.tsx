import { TaskStore, type Task, type TaskStatus } from "@combo-x/core";
import { useCallback, useEffect, useState } from "react";

const STATUSES: TaskStatus[] = ["todo", "doing", "done", "blocked"];

export function TasksPanel({
  taskStore,
  currentSessionId,
}: {
  taskStore: TaskStore;
  currentSessionId?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"all" | "global" | "session">("all");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    if (filter === "global") {
      setTasks(await taskStore.list({ globalOnly: true }));
    } else if (filter === "session" && currentSessionId) {
      setTasks(await taskStore.list({ sessionId: currentSessionId }));
    } else {
      setTasks(await taskStore.list());
    }
  }, [currentSessionId, filter, taskStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTask = async () => {
    const t = title.trim();
    if (!t) return;
    const sessionScoped = filter === "session" && currentSessionId;
    await taskStore.put({
      id: crypto.randomUUID(),
      title: t,
      status: "todo",
      sessionId: sessionScoped ? currentSessionId : null,
    });
    setTitle("");
    setMsg("Task created");
    await refresh();
  };

  return (
    <div className="panel tasks-panel">
      <h2>Tasks</h2>
      <p className="hint">Global task board — link to sessions or keep workspace-wide backlog.</p>

      <div className="row data-table-toolbar">
        <button
          type="button"
          className={filter === "all" ? "primary" : ""}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={filter === "global" ? "primary" : ""}
          onClick={() => setFilter("global")}
        >
          Global
        </button>
        <button
          type="button"
          className={filter === "session" ? "primary" : ""}
          disabled={!currentSessionId}
          onClick={() => setFilter("session")}
        >
          This session
        </button>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="row task-create">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task title…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void createTask();
          }}
        />
        <button type="button" className="primary" disabled={!title.trim()} onClick={() => void createTask()}>
          Add
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}

      <div className="task-list">
        {tasks.length === 0 ? (
          <p className="hint">No tasks yet — create one above or via agent tools.</p>
        ) : (
          tasks.map((task) => (
            <details key={task.id} className="task-row">
              <summary>
                <span className={`task-status-chip status-${task.status}`}>{task.status}</span>
                <span className="task-title">{task.title}</span>
                {task.sessionId ? (
                  <span className="hint task-session">
                    <code>{task.sessionId.slice(0, 8)}…</code>
                  </span>
                ) : (
                  <span className="hint task-session">global</span>
                )}
                <span className="hint task-time">{new Date(task.updatedAt).toLocaleString()}</span>
              </summary>
              <div className="task-body">
                <div className="task-status-row">
                  {STATUSES.map((s) => (
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
                    className="danger task-delete"
                    onClick={() =>
                      void (async () => {
                        if (!confirm(`Delete task “${task.title}”?`)) return;
                        await taskStore.remove(task.id);
                        await refresh();
                      })()
                    }
                  >
                    Delete
                  </button>
                </div>
                {task.note ? (
                  <p className="hint wrap task-note">{task.note}</p>
                ) : null}
                {task.planMarkdown ? (
                  <pre className="task-plan">{task.planMarkdown}</pre>
                ) : null}
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
