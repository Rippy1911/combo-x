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
        className="msg-action"
        title="Copy full message"
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
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        className={bookmarked ? "msg-action active" : "msg-action"}
        title={bookmarked ? "Remove bookmark" : "Bookmark message"}
        aria-pressed={!!bookmarked}
        onClick={onToggleBookmark}
      >
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </button>
    </div>
  );
}
