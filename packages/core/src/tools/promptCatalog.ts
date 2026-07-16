/**
 * Compact skill index + tool schemas for system-prompt inject (once per user turn).
 */

import type { Skill } from "../skills/store.js";
import type { ToolDefinition } from "../llm/openrouter.js";
import { AGENT_TOOLS } from "../browser/tools.js";
import { catalogEntry } from "./catalog.js";
import type { CustomTool } from "./customStore.js";

const DEFAULT_TOOL_CHARS = 14_000;
const DEFAULT_SKILL_LIMIT = 40;

/** Skill name/description/hints only — bodies stay on-demand via skill_read. */
export function formatSkillIndexBlock(
  skills: Skill[],
  opts?: { limit?: number },
): string {
  const limit = opts?.limit ?? DEFAULT_SKILL_LIMIT;
  const rows = skills.slice(0, limit);
  if (!rows.length) return "";
  const lines = rows.map((s, i) => {
    const scope = s.scope === "agent" ? "agent" : "global";
    const hints =
      s.toolHints?.length ? ` unlock:[${s.toolHints.slice(0, 8).join(", ")}]` : "";
    return `${i + 1}. ${s.name} (${scope}) — ${s.description.slice(0, 220)}${hints}`;
  });
  return (
    `AVAILABLE SKILLS (descriptions only; call skill_search / skill_read for full body + unlocks; skill_save to create/update if enabled):\n` +
    lines.join("\n")
  );
}

function schemaLine(def: ToolDefinition): string {
  const params = def.function.parameters ?? { type: "object", properties: {} };
  let json: string;
  try {
    json = JSON.stringify(params);
  } catch {
    json = "{}";
  }
  if (json.length > 900) json = `${json.slice(0, 900)}…`;
  return json;
}

/**
 * Tool descriptions + JSON-schema parameters for tools in the ceiling.
 * Marks skill-gated tools that are not yet active.
 */
export function formatToolSchemaBlock(
  ceilingNames: string[],
  activeNames: string[],
  extras?: { custom?: CustomTool[]; maxChars?: number },
): string {
  const maxChars = extras?.maxChars ?? DEFAULT_TOOL_CHARS;
  const active = new Set(activeNames);
  const byName = new Map(AGENT_TOOLS.map((t) => [t.function.name, t]));
  for (const c of extras?.custom ?? []) {
    byName.set(c.name, customToolToDefinition(c));
  }

  const lines: string[] = [
    "AVAILABLE TOOLS (also exposed as callable tool schemas; prefer tools over inventing):",
  ];
  for (const name of ceilingNames) {
    const def = byName.get(name);
    if (!def) continue;
    const meta = catalogEntry(name);
    const locked = !active.has(name);
    const lockNote = locked ? " [LOCKED until skill_read]" : "";
    const when = meta?.whenToUse ? ` When: ${meta.whenToUse}` : "";
    lines.push(
      `### ${def.function.name}${lockNote}\n${def.function.description}${when}\nparameters: ${schemaLine(def)}`,
    );
  }
  let out = lines.join("\n\n");
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars)}\n…(tool catalog truncated)`;
  }
  return ceilingNames.length ? out : "";
}

export function customToolToDefinition(tool: CustomTool): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
