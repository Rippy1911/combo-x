import type { ToolCatalogEntry } from "./catalog.js";

/** Minimal LLM surface for cheap tool picking (OpenRouter-compatible). */
export interface ToolPickerLlm {
  chat(input: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ content: string | null }>;
}

export const CORE_TOOL_NAMES = [
  "navigate",
  "page_digest",
  "wait",
  "list_tabs",
  "parse_data",
  "ensure_scrape_table",
  "upsert_scrape_rows",
  "remember",
  "recall",
] as const;

const PICKER_SYSTEM = `You pick the minimal tool set for a browser agent goal.
Return ONLY valid JSON: { "tools": string[], "rationale": string }
Rules:
- Include only tools from the provided catalog names.
- Prefer fewer tools; add extras only when clearly needed for the goal.
- Do not invent tool names.`;

function catalogNames(catalog: ToolCatalogEntry[]): Set<string> {
  return new Set(catalog.map((e) => e.name));
}

function intersectCore(available: Set<string>): string[] {
  return CORE_TOOL_NAMES.filter((n) => available.has(n));
}

function parsePickerJson(raw: string | null): { tools: string[]; rationale: string } | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const jsonText =
    trimmed.startsWith("```") ?
      trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  try {
    const parsed = JSON.parse(jsonText) as { tools?: unknown; rationale?: unknown };
    if (!Array.isArray(parsed.tools)) return null;
    const tools = parsed.tools.map(String).filter(Boolean);
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
    return { tools, rationale };
  } catch {
    return null;
  }
}

function mergeTools(core: string[], picked: string[], available: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...core, ...picked]) {
    if (!available.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Cheap worker LLM pass: pick minimal tools for a goal.
 * Always merges CORE_TOOL_NAMES intersected with catalog.
 */
export async function pickToolsForGoal(
  llm: ToolPickerLlm,
  workerModel: string,
  goal: string,
  catalog: ToolCatalogEntry[],
): Promise<{ tools: string[]; rationale: string }> {
  const available = catalogNames(catalog);
  const core = intersectCore(available);
  const catalogLines = catalog
    .map((e) => `- ${e.name} (${e.group}): ${e.description}`)
    .join("\n");

  const result = await llm.chat({
    model: workerModel,
    temperature: 0,
    maxTokens: 512,
    messages: [
      { role: "system", content: PICKER_SYSTEM },
      {
        role: "user",
        content: `Goal:\n${goal}\n\nCatalog:\n${catalogLines}\n\nReturn JSON { tools, rationale }.`,
      },
    ],
  });

  const parsed = parsePickerJson(result.content);
  if (!parsed) {
    return {
      tools: core,
      rationale: "Picker returned invalid JSON; using core tool set only.",
    };
  }

  const picked = parsed.tools.filter((n) => available.has(n));
  return {
    tools: mergeTools(core, picked, available),
    rationale: parsed.rationale || "Tools selected for goal.",
  };
}
