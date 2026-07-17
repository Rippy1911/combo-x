/**
 * Compact skill index + schema-less tool index for system-prompt inject (once per user turn).
 * Full JSON schemas stay on the OpenAI `tools[]` array for ACTIVE tools only.
 */

import type { Skill } from "../skills/store.js";
import type { ToolDefinition } from "../llm/openrouter.js";
import { AGENT_TOOLS } from "../browser/tools.js";
import { catalogEntry } from "./catalog.js";
import type { CustomTool } from "./customStore.js";
import {
  TOOL_PACKS,
  packForTool,
  type ToolPackId,
} from "./gating.js";

const DEFAULT_TOOL_CHARS = 6_000;
const DEFAULT_SKILL_LIMIT = 40;

/** Seed skill that unlocks each gated pack. */
export const PACK_SKILL_NAMES: Record<ToolPackId, string> = {
  scrape: "combo-scrape",
  rest: "combo-rest",
  rag: "combo-rag",
  "page-ext": "combo-page-ext",
  media: "combo-media",
};

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

function shortDesc(def: ToolDefinition): string {
  const meta = catalogEntry(def.function.name);
  const when = meta?.whenToUse ? ` When: ${meta.whenToUse}` : "";
  const desc = (def.function.description ?? "").replace(/\s+/g, " ").trim();
  const clipped = desc.length > 160 ? `${desc.slice(0, 160)}…` : desc;
  return `${clipped}${when}`;
}

/**
 * Schema-less tool index for the system prompt.
 * - ACTIVE tools: one-line name + description (no JSON parameters — those live on tools[]).
 * - LOCKED packs in the ceiling: pack → skill name + tool name list.
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
    "TOOL INDEX (no parameter schemas here — callable JSON schemas are attached only for ACTIVE tools via the API tools[] array):",
    "Locked specialty packs need skill_search → skill_read (e.g. combo-scrape) before they become ACTIVE.",
  ];

  const activeListed = ceilingNames.filter((n) => active.has(n) && byName.has(n));
  if (activeListed.length) {
    lines.push(`ACTIVE (${activeListed.length}):`);
    for (const name of activeListed) {
      const def = byName.get(name)!;
      lines.push(`- ${name} — ${shortDesc(def)}`);
    }
  }

  const lockedByPack = new Map<ToolPackId, string[]>();
  const lockedOther: string[] = [];
  for (const name of ceilingNames) {
    if (active.has(name) || !byName.has(name)) continue;
    const pack = packForTool(name);
    if (pack) {
      const list = lockedByPack.get(pack) ?? [];
      list.push(name);
      lockedByPack.set(pack, list);
    } else {
      lockedOther.push(name);
    }
  }

  if (lockedByPack.size || lockedOther.length) {
    lines.push("LOCKED packs (skill_read to unlock; schemas appear after unlock):");
    for (const pack of Object.keys(TOOL_PACKS) as ToolPackId[]) {
      const tools = lockedByPack.get(pack);
      if (!tools?.length) continue;
      const skill = PACK_SKILL_NAMES[pack];
      lines.push(`- ${pack} → ${skill}: ${tools.join(", ")}`);
    }
    for (const name of lockedOther) {
      lines.push(`- ${name} [LOCKED until skill_read] — ${shortDesc(byName.get(name)!)}`);
    }
  }

  let out = lines.join("\n");
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
