/**
 * Tool gating: lean ALWAYS_ON attached every turn; SKILL_GATED unlock via skill_read.
 * Ceiling (enabledTools / profile allowlist) still applies.
 */

export const SKILL_META_TOOLS = [
  "skill_search",
  "skill_read",
  "skill_save",
  "list_custom_tools",
  "custom_tool_save",
] as const;

/** Attached every run when in the ceiling (browse + memory + skill meta + light meta). */
export const ALWAYS_ON_TOOL_NAMES: readonly string[] = [
  "navigate",
  "go_back",
  "wait",
  "list_tabs",
  "open_tab",
  "activate_tab",
  "close_tab",
  "page_digest",
  "get_page",
  "get_links",
  "get_interactive",
  "click_index",
  "type_index",
  "click",
  "type_text",
  "extract",
  "scroll",
  "find_text",
  "parse_data",
  "remember",
  "save_memory",
  "recall",
  "memory_list",
  ...SKILL_META_TOOLS,
  "search_sessions",
  "get_session",
  "list_tasks",
  "create_task",
  "update_task",
  "reorder_tasks",
  "save_bookmark",
  "set_reminder",
  "create_report",
  "create_map_report",
  "publish_upload",
  "list_agents",
  "create_agent",
  "update_agent",
  "spawn_subagent",
  /** UX Vision Lab — capture+attach without unlocking raw screenshot tools */
  "ux_critique",
  "open_preview",
  "annotate_screenshot",
  "page_css_preview",
  "page_css_clear",
];

/**
 * Always merge into the run ceiling (unless allowlist is explicitly empty).
 * Prevents stale localStorage/profile allowlists from hiding Vision Lab tools
 * that the system prompt requires for visual UX audits.
 */
export const FORCE_ATTACH_TOOL_NAMES: readonly string[] = [
  "ux_critique",
  "open_preview",
  "annotate_screenshot",
  "page_css_preview",
  "page_css_clear",
  "skill_search",
  "skill_read",
];

export const TOOL_PACKS = {
  scrape: [
    "ensure_scrape_table",
    "upsert_scrape_rows",
    "get_scrape_table",
    "scrape_catalog",
    "scrape_pdps",
    "query_all",
    "scrape_tables",
    "export_csv",
    "save_view",
    "list_views",
    "get_view",
    "login",
    "save_site_profile",
    "get_site_profile",
  ],
  rest: ["rest_request", "mcp_list_tools", "mcp_call"],
  rag: ["rag_search", "rag_read_file", "rag_status", "list_attachments", "read_attachment"],
  "page-ext": [
    "create_page_extension",
    "update_page_extension",
    "list_page_extensions",
    "get_page_extension",
    "approve_page_extension",
    "revoke_page_extension",
    "inject_page_extension",
    "set_page_extension_bridge",
    "page_ext_data_list",
    "page_ext_data_get",
    "page_ext_data_clear",
    "list_page_extension_audit",
  ],
  media: [
    "screenshot_viewport",
    "screenshot_element",
    "screenshot_full",
    "start_recording",
    "stop_recording",
  ],
} as const;

export type ToolPackId = keyof typeof TOOL_PACKS;

export const SKILL_GATED_TOOL_NAMES: readonly string[] = Object.values(TOOL_PACKS).flat();

const ALWAYS_ON_SET = new Set<string>(ALWAYS_ON_TOOL_NAMES);
const GATED_SET = new Set<string>(SKILL_GATED_TOOL_NAMES);

export function isSkillGatedTool(name: string): boolean {
  return GATED_SET.has(name);
}

export function isAlwaysOnTool(name: string): boolean {
  return ALWAYS_ON_SET.has(name);
}

export function packForTool(name: string): ToolPackId | null {
  for (const [pack, tools] of Object.entries(TOOL_PACKS) as Array<[ToolPackId, readonly string[]]>) {
    if ((tools as readonly string[]).includes(name)) return pack;
  }
  return null;
}

export function intersectNames(names: readonly string[], ceiling: ReadonlySet<string>): string[] {
  return names.filter((n) => ceiling.has(n));
}

export function unionNames(...lists: Array<readonly string[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const n of list) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function initialActiveTools(ceiling: ReadonlySet<string>): string[] {
  return intersectNames(ALWAYS_ON_TOOL_NAMES, ceiling);
}

/** Merge FORCE_ATTACH into a non-empty allowlist (no-op for explicit []). */
export function ensureForceAttachTools(enabled: string[]): string[] {
  if (enabled.length === 0) return enabled;
  return unionNames(enabled, FORCE_ATTACH_TOOL_NAMES);
}

export function unlockFromHints(
  active: readonly string[],
  hints: readonly string[],
  ceiling: ReadonlySet<string>,
): { active: string[]; unlocked: string[] } {
  const unlocked = hints.filter(
    (n) => ceiling.has(n) && (GATED_SET.has(n) || ALWAYS_ON_SET.has(n)),
  );
  return { active: unionNames(active, unlocked), unlocked };
}
