import { AGENT_TOOLS, isAlwaysOnTool, packForTool } from "@combo-x/core";
import { useMemo } from "react";
import { GROUP_ORDER, TOOL_GROUPS } from "./toolGroups";

export function ToolsLibrary({
  enabledTools,
  setEnabledTools,
}: {
  enabledTools: Set<string>;
  setEnabledTools?: (fn: (prev: Set<string>) => Set<string>) => void;
}) {
  const allToolNames = useMemo(() => AGENT_TOOLS.map((t) => t.function.name), []);

  const toggle = (name: string) => {
    if (!setEnabledTools) return;
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const gateBadge = (name: string) => {
    if (isAlwaysOnTool(name)) {
      return <span className="gate-badge always-on">Always on</span>;
    }
    const pack = packForTool(name);
    if (pack) {
      return <span className="gate-badge skill-gated">Skill-gated ({pack})</span>;
    }
    return <span className="gate-badge">Other</span>;
  };

  const readOnly = !setEnabledTools;

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Ceiling: tools allowed for this browser / agent profile. Skill-gated tools still need
        skill_read during a run to unlock — enabling here only adds them to the ceiling.
      </p>
      {!readOnly ? (
        <div className="row">
          <button
            type="button"
            onClick={() => setEnabledTools!(() => new Set(allToolNames))}
          >
            Enable all
          </button>
          <button type="button" onClick={() => setEnabledTools!(() => new Set())}>
            Disable all
          </button>
        </div>
      ) : (
        <p className="hint">Read-only — no setter provided.</p>
      )}
      <div className="tool-groups">
        {GROUP_ORDER.map((group) => {
          const names = TOOL_GROUPS[group].filter((n) => allToolNames.includes(n));
          if (!names.length) return null;
          return (
            <div key={group} className="tool-group">
              <h4>{group}</h4>
              <ul className="list compact">
                {names.map((name) => (
                  <li key={name}>
                    <label className="tool-row">
                      <input
                        type="checkbox"
                        checked={enabledTools.has(name)}
                        disabled={readOnly}
                        onChange={() => toggle(name)}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <code>{name}</code>
                        <div style={{ marginTop: 4 }}>{gateBadge(name)}</div>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
