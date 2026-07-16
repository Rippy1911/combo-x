import {
  AGENT_TOOLS,
  CustomToolStore,
  isAlwaysOnTool,
  packForTool,
  type CustomTool,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GROUP_ORDER, TOOL_GROUPS } from "./toolGroups";

export function ToolsLibrary({
  enabledTools,
  setEnabledTools,
  customTools,
}: {
  enabledTools: Set<string>;
  setEnabledTools?: (fn: (prev: Set<string>) => Set<string>) => void;
  customTools?: CustomToolStore;
}) {
  const allToolNames = useMemo(() => AGENT_TOOLS.map((t) => t.function.name), []);
  const [custom, setCustom] = useState<CustomTool[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [paramsJson, setParamsJson] = useState(
    '{\n  "type": "object",\n  "properties": {}\n}',
  );
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshCustom = useCallback(async () => {
    if (!customTools) return;
    setCustom(await customTools.list());
  }, [customTools]);

  useEffect(() => {
    void refreshCustom();
  }, [refreshCustom]);

  const toggle = (toolName: string) => {
    if (!setEnabledTools) return;
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  };

  const gateBadge = (toolName: string) => {
    if (isAlwaysOnTool(toolName)) {
      return <span className="gate-badge always-on">Always on</span>;
    }
    const pack = packForTool(toolName);
    if (pack) {
      return <span className="gate-badge skill-gated">Skill-gated ({pack})</span>;
    }
    return <span className="gate-badge">Other</span>;
  };

  const readOnly = !setEnabledTools;

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Global ceiling persists in localStorage (additive migrate — disabling tools no longer resets
        on reload). With an active agent profile, toggles also update that agent&apos;s allowlist.
        Skill-gated tools still need skill_read during a run.
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
                {names.map((toolName) => (
                  <li key={toolName}>
                    <label className="tool-row">
                      <input
                        type="checkbox"
                        checked={enabledTools.has(toolName)}
                        disabled={readOnly}
                        onChange={() => toggle(toolName)}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <code>{toolName}</code>
                        <div style={{ marginTop: 4 }}>{gateBadge(toolName)}</div>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {customTools ? (
        <div className="custom-tools-block">
          <h3>Custom tools</h3>
          <p className="hint wrap">
            Add snake_case tools with JSON-schema parameters. They merge into the LLM tool list.
            kind=guide returns your note when called. Agent can also use{" "}
            <code>custom_tool_save</code> when enabled.
          </p>
          <ul className="list compact">
            {custom.map((t) => (
              <li key={t.id} className="session-row">
                <div>
                  <code>{t.name}</code> · {t.kind}
                  <div className="hint wrap">{t.description}</div>
                </div>
                <button
                  type="button"
                  className="msg-action dangerish"
                  onClick={() =>
                    void (async () => {
                      await customTools.delete(t.id);
                      await refreshCustom();
                      setMsg(`Deleted ${t.name}`);
                    })()
                  }
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <div className="stack-form">
            <input
              placeholder="name (snake_case)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              placeholder="description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <textarea
              rows={4}
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
              spellCheck={false}
            />
            <input
              placeholder="handler note (returned on call)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setMsg("");
                  try {
                    const parameters = JSON.parse(paramsJson) as Record<string, unknown>;
                    const saved = await customTools.save({
                      name,
                      description: desc,
                      parameters,
                      kind: "guide",
                      handlerNote: note,
                    });
                    setName("");
                    setDesc("");
                    setNote("");
                    setMsg(`Saved ${saved.name}`);
                    await refreshCustom();
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              Add custom tool
            </button>
            {msg ? <p className="hint">{msg}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
