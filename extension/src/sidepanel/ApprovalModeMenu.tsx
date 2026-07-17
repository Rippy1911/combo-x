import type { ApprovalMode } from "@combo-x/core";
import { useEffect, useRef, useState } from "react";

const LABELS: Record<ApprovalMode, string> = {
  ask: "Ask each action",
  auto_llm: "Auto (smart LLM)",
  auto_all: "Auto-approve all",
};

export function ApprovalModeMenu({
  mode,
  onChange,
}: {
  mode: ApprovalMode;
  onChange: (m: ApprovalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const icon = mode === "ask" ? "?" : mode === "auto_llm" ? "⚡" : "∞";

  return (
    <div className="approval-mode-menu" ref={ref}>
      <button
        type="button"
        className={
          mode === "auto_all"
            ? "msg-action icon-btn active dangerish"
            : mode === "auto_llm"
              ? "msg-action icon-btn active"
              : "msg-action icon-btn"
        }
        title={`Approval: ${LABELS[mode]} — click to configure`}
        aria-label={`Approval mode: ${LABELS[mode]}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
      </button>
      {open ? (
        <div className="approval-mode-pop">
          {(Object.keys(LABELS) as ApprovalMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={
                m === mode ? "approval-mode-opt active" : "approval-mode-opt"
              }
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
            >
              <strong>{LABELS[m]}</strong>
              <span>
                {m === "ask"
                  ? "Prompt for each sensitive tool"
                  : m === "auto_llm"
                    ? "Cheap model judges intent"
                    : "Skip prompts for this browser"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
