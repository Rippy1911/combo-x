import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { copyText, nodeText } from "./chatClipboard";

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = nodeText(children).replace(/\n$/, "");

  return (
    <div className="md-pre-wrap">
      <button
        type="button"
        className="md-copy"
        title="Copy code block"
        onClick={() => {
          void (async () => {
            const ok = await copyText(text);
            if (ok) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }
          })();
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export const MarkdownView = memo(function MarkdownView({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  if (!content) {
    return streaming ? <span className="md-cursor" aria-hidden /> : null;
  }
  return (
    <div className={`md${streaming ? " md-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming ? <span className="md-cursor" aria-hidden /> : null}
    </div>
  );
});
