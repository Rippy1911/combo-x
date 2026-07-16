import type { ChatSession, SessionStore } from "@combo-x/core";
import { useEffect, useState } from "react";
import { copyText, shortConversationId } from "./chatClipboard";

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export function SessionsDrawer({
  open,
  onClose,
  sessions,
  sessionList,
  refreshSessions,
  currentSessionId,
  onOpenSession,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionStore;
  sessionList: ChatSession[];
  refreshSessions: () => Promise<void>;
  currentSessionId?: string;
  onOpenSession: (id: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [list, setList] = useState<ChatSession[]>(sessionList);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open) {
      setList(sessionList);
      void refreshSessions();
    }
  }, [open, sessionList, refreshSessions]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visible = list.filter((s) => {
    if (!bookmarksOnly) return true;
    return !!s.bookmarked || s.messages.some((m) => m.bookmarked && m.role !== "system");
  });

  return (
    <div className="sessions-drawer-root" role="dialog" aria-label="Sessions history">
      <button type="button" className="sessions-drawer-backdrop" aria-label="Close" onClick={onClose} />
      <aside className="sessions-drawer">
        <div className="sessions-drawer-head">
          <h2>Sessions</h2>
          <button type="button" className="msg-action" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="hint wrap">Local IndexedDB history. Wide: side panel · narrow: full overlay.</p>
        <div className="row wrap">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search past sessions…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void (async () => {
                  if (!query.trim()) {
                    await refreshSessions();
                    return;
                  }
                  setList(await sessions.search(query, 40));
                })();
              }
            }}
          />
          <button
            type="button"
            onClick={() =>
              void (async () => {
                if (!query.trim()) {
                  await refreshSessions();
                  setList(sessionList);
                  return;
                }
                setList(await sessions.search(query, 40));
              })()
            }
          >
            Search
          </button>
          <button
            type="button"
            className={bookmarksOnly ? "primary" : undefined}
            aria-pressed={bookmarksOnly}
            onClick={() => setBookmarksOnly((v) => !v)}
          >
            Bookmarks
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              void (async () => {
                await onNewChat();
                onClose();
              })()
            }
          >
            New chat
          </button>
        </div>
        {msg ? <p className="hint">{msg}</p> : null}
        <ul className="list sessions-drawer-list">
          {visible.map((s) => {
            const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
            const lastAsst = [...s.messages].reverse().find((m) => m.role === "assistant");
            const active = s.id === currentSessionId;
            return (
              <li
                key={s.id}
                className={`session-row${s.bookmarked ? " bookmarked" : ""}${active ? " active" : ""}`}
              >
                {renamingId === s.id ? (
                  <div className="session-rename">
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        void (async () => {
                          const title = renameDraft.trim() || s.title || "Untitled";
                          await sessions.save({ ...s, title });
                          setRenamingId(null);
                          setMsg("Renamed");
                          await refreshSessions();
                        })()
                      }
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="linkish session-open"
                      onClick={() =>
                        void (async () => {
                          await onOpenSession(s.id);
                          onClose();
                        })()
                      }
                    >
                      <strong>
                        {s.bookmarked ? "[B] " : ""}
                        {s.title || "Untitled"}
                        {active ? " · open" : ""}
                      </strong>
                      {lastUser?.content ? (
                        <>
                          <br />
                          <span className="hint clamp-2">You: {lastUser.content}</span>
                        </>
                      ) : null}
                      {lastAsst?.content ? (
                        <>
                          <br />
                          <span className="hint clamp-2">Agent: {lastAsst.content}</span>
                        </>
                      ) : null}
                      <br />
                      <span className="hint">
                        {new Date(s.updatedAt).toLocaleString()} · {s.totalTokens} tok ·{" "}
                        {formatUsd(s.estimatedCostUsd)}
                      </span>
                      <br />
                      <span className="hint mono-id" title={s.id}>
                        id {shortConversationId(s.id)}
                      </span>
                    </button>
                    <div className="session-actions">
                      <button
                        type="button"
                        className="msg-action"
                        title="Rename"
                        onClick={() => {
                          setRenamingId(s.id);
                          setRenameDraft(s.title || "");
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="msg-action"
                        title="Copy conversation id"
                        onClick={() => void copyText(s.id)}
                      >
                        Copy id
                      </button>
                      <button
                        type="button"
                        className="msg-action dangerish"
                        title="Delete session"
                        onClick={() =>
                          void (async () => {
                            if (!window.confirm(`Delete “${s.title || "Untitled"}”?`)) return;
                            await sessions.delete(s.id);
                            setMsg("Deleted");
                            await refreshSessions();
                            if (s.id === currentSessionId) await onNewChat();
                          })()
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
