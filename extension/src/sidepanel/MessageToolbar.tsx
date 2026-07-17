import { useState } from "react";
import { copyText, formatMessageTime } from "./chatClipboard";

export function MessageToolbar({
  content,
  createdAt,
  bookmarked,
  onToggleBookmark,
}: {
  content: string;
  createdAt?: string;
  bookmarked?: boolean;
  onToggleBookmark: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const time = formatMessageTime(createdAt);

  return (
    <div className="msg-toolbar" role="group" aria-label="Message actions">
      {time ? (
        <time className="msg-time" dateTime={createdAt} title={createdAt}>
          {time}
        </time>
      ) : null}
      <button
        type="button"
        className="msg-action icon-btn"
        title="Copy full message"
        aria-label="Copy message"
        disabled={!content.trim()}
        onClick={() => {
          void (async () => {
            const ok = await copyText(content);
            if (ok) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }
          })();
        }}
      >
        {copied ? "✓" : "⎘"}
      </button>
      <button
        type="button"
        className={bookmarked ? "msg-action icon-btn active" : "msg-action icon-btn"}
        title={bookmarked ? "Remove bookmark" : "Bookmark message"}
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
        aria-pressed={!!bookmarked}
        onClick={onToggleBookmark}
      >
        {bookmarked ? "★" : "☆"}
      </button>
    </div>
  );
}
