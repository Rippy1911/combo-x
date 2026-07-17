import { TaskStore, taskProgress, type Task, type TaskStatus } from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";

const STATUSES: TaskStatus[] = ["todo", "doing", "done", "blocked"];

export function TasksPanel({
  taskStore,
  currentSessionId,
}: {
  taskStore: TaskStore;
  currentSessionId?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"all" | "global" | "session">("session");
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

  const openTasks = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.status === "done"), [tasks]);
  const { done, total } = taskProgress(tasks);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const showSplit = filter === "session" || filter === "global";

  const renderTask = (task: Task) => (
    <details key={task.id} className="task-row">
      <summary>
        <span className={`task-status-chip status-${task.status}`}>{task.status}</span>
        <span className={`task-title${task.status === "done" ? " done" : ""}`}>{task.title}</span>
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
        {task.note ? <p className="hint wrap task-note">{task.note}</p> : null}
        {task.planMarkdown ? <pre className="task-plan">{task.planMarkdown}</pre> : null}
      </div>
    </details>
  );

  return (
    <div className="panel tasks-panel">
      <h2>Tasks</h2>
      <p className="hint wrap">
        Global / all-session board. For this chat, prefer the <strong>Conversation Tasks</strong>{" "}
        drawer (☑) in Chat — progress, reorder, and DONE live there.
      </p>

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

      {showSplit && total > 0 ? (
        <div className="task-progress">
          <span className="hint">
            {done}/{total} done ({pct}%)
          </span>
          <div className="task-progress-bar" aria-hidden>
            <div className="task-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="row task-create">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            filter === "session" ? "New task for this session…" : "New global / board task…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") void createTask();
          }}
        />
        <button type="button" className="primary" disabled={!title.trim()} onClick={() => void createTask()}>
          Add
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}

      {showSplit ? (
        <>
          <div className="task-list">
            {openTasks.length === 0 ? (
              <p className="hint">No open tasks in this filter.</p>
            ) : (
              openTasks.map(renderTask)
            )}
          </div>
          {doneTasks.length > 0 ? (
            <section className="conv-task-done">
              <h3>DONE ({doneTasks.length})</h3>
              <div className="task-list">{doneTasks.map(renderTask)}</div>
            </section>
          ) : null}
        </>
      ) : (
        <div className="task-list">
          {tasks.length === 0 ? (
            <p className="hint">No tasks yet — create one above or via agent tools.</p>
          ) : (
            tasks.map(renderTask)
          )}
        </div>
      )}
    </div>
  );
}
