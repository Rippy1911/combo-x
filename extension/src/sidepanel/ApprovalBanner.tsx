export function ApprovalBanner(props: {
  tool: string;
  args: Record<string, unknown>;
  onAllow: () => void;
  onDeny: () => void;
  onAutoAll: () => void;
  onAutoSmart: () => void;
}) {
  return (
    <div className="approval">
      <div className="approval-title">Allow action?</div>
      <div className="approval-tool">
        <code>{props.tool}</code>
      </div>
      <pre className="approval-args">{JSON.stringify(props.args, null, 2).slice(0, 800)}</pre>
      <div className="row">
        <button type="button" className="primary" onClick={props.onAllow}>
          Allow
        </button>
        <button type="button" className="danger" onClick={props.onDeny}>
          Deny
        </button>
        <button type="button" onClick={props.onAutoSmart} title="Let a cheap LLM judge intent for the rest of this session">
          Auto (smart)
        </button>
        <button type="button" onClick={props.onAutoAll}>
          Auto-approve all (session)
        </button>
      </div>
    </div>
  );
}
