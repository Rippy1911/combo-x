import type { ChatSession, SessionStore } from "@combo-x/core";
import { useEffect, useState } from "react";
import { copyText, formatMessageTime, shortConversationId } from "./chatClipboard";
import type { SessionRuntimeMeta } from "./sessionRuntime";

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export function SessionsDrawer({
  open,
  pinned,
  onClose,
  onTogglePin,
  sessions,
  sessionList,
  refreshSessions,
  currentSessionId,
  onOpenSession,
  onNewChat,
  runtimeMeta = [],
}: {
  open: boolean;
  pinned: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  sessions: SessionStore;
  sessionList: ChatSession[];
  refreshSessions: () => Promise<void>;
  currentSessionId?: string;
  onOpenSession: (id: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  runtimeMeta?: SessionRuntimeMeta[];
}) {
  const [query, setQuery] = useState("");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [list, setList] = useState<ChatSession[]>(sessionList);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [msg, setMsg] = useState("");

  const metaById = new Map(runtimeMeta.map((m) => [m.sessionId, m]));

  useEffect(() => {
    if (open || pinned) {
      setList(sessionList);
      void refreshSessions();
    }
  }, [open, pinned, sessionList, refreshSessions]);

  useEffect(() => {
    if (!open || pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pinned, onClose]);

  if (!open && !pinned) return null;

  const runSearch = async () => {
    if (!query.trim()) {
      await refreshSessions();
      setList(sessionList);
      return;
    }
    setList(await sessions.search(query, 40));
  };

  const visible = list.filter((s) => {
    if (!bookmarksOnly) return true;
    return !!s.bookmarked || s.messages.some((m) => m.bookmarked && m.role !== "system");
  });

  const openSession = (id: string) => {
    void (async () => {
      await onOpenSession(id);
      if (!pinned) onClose();
    })();
  };

  return (
    <div
      className={`sessions-drawer-root${pinned ? " pinned" : ""}`}
      role={pinned ? "navigation" : "dialog"}
      aria-label="Sessions history"
    >
      {!pinned ? (
        <button
          type="button"
          className="sessions-drawer-backdrop"
          aria-label="Close"
          onClick={onClose}
        />
      ) : null}
      <aside className={`sessions-drawer${pinned ? " pinned" : ""}`}>
        <div className="sessions-drawer-head">
          <h2>Sessions</h2>
          <div className="sessions-drawer-head-actions">
            <button
              type="button"
              className={pinned ? "msg-action icon-btn active" : "msg-action icon-btn"}
              title={pinned ? "Unpin sidebar" : "Pin sidebar (keep open)"}
              aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
              aria-pressed={pinned}
              onClick={onTogglePin}
            >
              {pinned ? "◉" : "○"}
            </button>
            {!pinned ? (
              <button
                type="button"
                className="msg-action icon-btn"
                title="Close"
                aria-label="Close"
                onClick={onClose}
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>
        <div className="sessions-search-row">
          <div className="sessions-search">
            <span className="sessions-search-icon" aria-hidden>
              ⌕
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
            />
            {query ? (
              <button
                type="button"
                className="sessions-search-clear"
                title="Clear"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  void refreshSessions().then(() => setList(sessionList));
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={bookmarksOnly ? "msg-action icon-btn active" : "msg-action icon-btn"}
            title="Bookmarks only"
            aria-label="Filter bookmarks"
            aria-pressed={bookmarksOnly}
            onClick={() => setBookmarksOnly((v) => !v)}
          >
            ★
          </button>
          <button
            type="button"
            className="msg-action icon-btn primary-ish"
            title="New chat"
            aria-label="New chat"
            onClick={() =>
              void (async () => {
                await onNewChat();
                if (!pinned) onClose();
              })()
            }
          >
            ＋
          </button>
        </div>
        {msg ? <p className="hint">{msg}</p> : null}
        <ul className="list sessions-drawer-list">
          {visible.map((s) => {
            const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
            const lastAsst = [...s.messages].reverse().find((m) => m.role === "assistant");
            const asstPreview =
              lastAsst?.content?.trim() ||
              [...(lastAsst?.blocks ?? [])]
                .reverse()
                .find((b) => b.kind === "message" || b.kind === "thought")
                ?.text ||
              "";
            const active = s.id === currentSessionId;
            const meta = metaById.get(s.id);
            const running = !!meta?.running;
            const unread = !!meta?.unread && !active;
            const preview =
              lastUser?.content?.trim() ||
              asstPreview ||
              "";
            return (
              <li
                key={s.id}
                className={`session-card${s.bookmarked ? " bookmarked" : ""}${active ? " active" : ""}${unread ? " unread" : ""}${running ? " running" : ""}`}
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
                    <div className="session-card-top">
                      <button
                        type="button"
                        className="session-title"
                        title={s.title || "Untitled"}
                        onClick={() => openSession(s.id)}
                      >
                        {unread ? <span className="session-unread-dot" title="New reply" /> : null}
                        {running ? (
                          <span className="session-running-dot" title="Running in background" />
                        ) : null}
                        <strong>
                          {s.bookmarked ? "★ " : ""}
                          {s.title || "Untitled"}
                        </strong>
                      </button>
                      <div className="session-actions">
                        <button
                          type="button"
                          className="msg-action icon-btn"
                          title="Rename"
                          aria-label="Rename"
                          onClick={() => {
                            setRenamingId(s.id);
                            setRenameDraft(s.title || "");
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="msg-action icon-btn"
                          title="Copy conversation id"
                          aria-label="Copy id"
                          onClick={() => void copyText(s.id)}
                        >
                          ⎘
                        </button>
                        <button
                          type="button"
                          className="msg-action icon-btn dangerish"
                          title="Delete session"
                          aria-label="Delete"
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
                          ⌫
                        </button>
                      </div>
                    </div>
                    {preview ? (
                      <button
                        type="button"
                        className="session-preview"
                        onClick={() => openSession(s.id)}
                      >
                        {preview}
                      </button>
                    ) : null}
                    <div className="session-meta">
                      <span>{formatMessageTime(s.updatedAt)}</span>
                      <span>·</span>
                      <span>{s.totalTokens.toLocaleString()} tok</span>
                      <span>·</span>
                      <span>{formatUsd(s.estimatedCostUsd)}</span>
                      <code className="session-id" title={s.id}>
                        {shortConversationId(s.id, 10)}
                      </code>
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
