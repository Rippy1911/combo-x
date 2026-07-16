import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function MarkdownView({
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
      {streaming ? <span className="md-cursor" aria-hidden /> : null}
    </div>
  );
}
