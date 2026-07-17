import {
  AGENT_TOOLS,
  ALWAYS_ON_TOOL_NAMES,
  initialActiveTools,
  isSkillGatedTool,
  packForTool,
  type AgentToolMode,
} from "@combo-x/core";
import { useMemo, useState } from "react";

export function ToolAccessPicker({
  enabledTools,
  setEnabledTools,
  toolMode,
  unlockedThisRun,
  onInspectContext,
  inspectDisabled,
}: {
  enabledTools: Set<string>;
  setEnabledTools: (fn: (prev: Set<string>) => Set<string>) => void;
  toolMode: AgentToolMode;
  /** Tools unlocked via skill_read in the current run (session chrome). */
  unlockedThisRun: string[];
  /** Preview what Send will attach (system / tools / ≈tokens). */
  onInspectContext?: () => void;
  inspectDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const ceiling = useMemo(() => new Set(enabledTools), [enabledTools]);
  const activeNow = useMemo(() => {
    if (toolMode === "static") {
      return AGENT_TOOLS.map((t) => t.function.name).filter((n) => ceiling.has(n));
    }
    const base = initialActiveTools(ceiling);
    const unlocked = unlockedThisRun.filter((n) => ceiling.has(n));
    return [...new Set([...base, ...unlocked])];
  }, [ceiling, toolMode, unlockedThisRun]);

  const gatedLocked = useMemo(() => {
    return AGENT_TOOLS.map((t) => t.function.name).filter(
      (n) => ceiling.has(n) && isSkillGatedTool(n) && !activeNow.includes(n),
    );
  }, [ceiling, activeNow]);

  const toggle = (name: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="tool-access">
      <div className="tool-access-trigger">
        <button
          type="button"
          className={open ? "msg-action active" : "msg-action"}
          title="Tools attached this turn vs skill-gated (need skill_read)"
          onClick={() => setOpen((o) => !o)}
        >
          Tools {activeNow.length}/{ceiling.size}
          {toolMode === "skill_gated" ? " · gated" : " · static"}
        </button>
        <button
          type="button"
          className="msg-action icon-btn tool-access-help"
          title="Context — what will be sent on Send (system, tools, ≈tokens)"
          aria-label="Preview outbound context"
          disabled={inspectDisabled || !onInspectContext}
          onClick={() => onInspectContext?.()}
        >
          ⌗
        </button>
      </div>
      {unlockedThisRun.length > 0 ? (
        <span className="hint">+{unlockedThisRun.length} unlocked this run</span>
      ) : null}
      {open ? (
        <div className="tool-access-pop">
          <p className="hint wrap">
            <strong>Mode: {toolMode}</strong>
            {toolMode === "skill_gated" ? (
              <>
                {" "}
                — green tools stream with each call. Skill-gated stay locked until{" "}
                <code>skill_read</code> (seeds: combo-scrape, combo-rest, combo-rag, …). Checkboxes =
                ceiling (never allow if unchecked).
              </>
            ) : (
              <> — full ceiling attaches every turn (good for expensive orch / auto-pick).</>
            )}
          </p>
          <div className="row">
            <button
              type="button"
              onClick={() => setEnabledTools(() => new Set(AGENT_TOOLS.map((t) => t.function.name)))}
            >
              Enable all
            </button>
            <button type="button" onClick={() => setEnabledTools(() => new Set(ALWAYS_ON_TOOL_NAMES))}>
              Always-on only
            </button>
            <button type="button" onClick={() => setEnabledTools(() => new Set())}>
              Clear
            </button>
          </div>
          <h4 className="tool-access-h">Attached now ({activeNow.length})</h4>
          <ul className="tool-access-list">
            {activeNow.map((name) => (
              <li key={name}>
                <label className="tool-row">
                  <input type="checkbox" checked={ceiling.has(name)} onChange={() => toggle(name)} />
                  <span>
                    <strong>{name}</strong>{" "}
                    <span className="gate-badge on">
                      {isSkillGatedTool(name) ? `unlocked:${packForTool(name) ?? "?"}` : "always-on"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {toolMode === "skill_gated" && gatedLocked.length > 0 ? (
            <>
              <h4 className="tool-access-h">Locked until skill_read ({gatedLocked.length})</h4>
              <ul className="tool-access-list muted">
                {gatedLocked.map((name) => (
                  <li key={name}>
                    <label className="tool-row">
                      <input
                        type="checkbox"
                        checked={ceiling.has(name)}
                        onChange={() => toggle(name)}
                      />
                      <span>
                        <strong>{name}</strong>{" "}
                        <span className="gate-badge">{packForTool(name) ?? "gated"}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {unlockedThisRun.length > 0 ? (
            <p className="hint">
              Unlocked this run: {unlockedThisRun.slice(0, 12).join(", ")}
              {unlockedThisRun.length > 12 ? "…" : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
