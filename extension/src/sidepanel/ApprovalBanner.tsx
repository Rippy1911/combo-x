import { targetKeyFromArgs } from "@combo-x/core";

export function ApprovalBanner(props: {
  tool: string;
  args: Record<string, unknown>;
  onAllow: () => void;
  onDeny: () => void;
  onAutoAll: () => void;
  onAutoSmart: () => void;
  /** Remember this tool for any args */
  onAlwaysAllowTool: () => void;
  /** Remember this tool + target fingerprint (url/selector/index) */
  onAlwaysAllowTarget: () => void;
}) {
  const target = targetKeyFromArgs(props.tool, props.args);

  return (
    <div className="approval">
      <div className="approval-title">Allow action?</div>
      <div className="approval-tool">
        <code>{props.tool}</code>
      </div>
      <pre className="approval-args">{JSON.stringify(props.args, null, 2).slice(0, 800)}</pre>
      <div className="row wrap">
        <button type="button" className="primary" onClick={props.onAllow}>
          Allow
        </button>
        <button type="button" className="danger" onClick={props.onDeny}>
          Deny
        </button>
        <button
          type="button"
          onClick={props.onAlwaysAllowTool}
          title="Always allow this tool (any args) until forgotten in Settings"
        >
          Always allow action
        </button>
        {target ? (
          <button
            type="button"
            onClick={props.onAlwaysAllowTarget}
            title={`Always allow when target matches: ${target}`}
          >
            Always allow target
          </button>
        ) : null}
        <button
          type="button"
          onClick={props.onAutoSmart}
          title="Cheap LLM judges intent for this browser (saved in Settings)"
        >
          Auto (smart)
        </button>
        <button
          type="button"
          onClick={props.onAutoAll}
          title="Auto-approve all sensitive tools in this browser (saved in Settings)"
        >
          Auto-approve all
        </button>
      </div>
      {target ? <p className="hint wrap">Target: <code>{target}</code></p> : null}
    </div>
  );
}
