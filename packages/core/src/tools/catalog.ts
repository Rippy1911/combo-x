import { AGENT_TOOLS } from "../browser/tools.js";
import type { ToolDefinition } from "../llm/openrouter.js";

export type ToolGroup =
  | "browser"
  | "data"
  | "media"
  | "memory"
  | "connectors"
  | "agentic"
  | "meta";

export interface ToolCatalogEntry {
  name: string;
  description: string;
  group: ToolGroup;
  useCases: string[];
  whenToUse: string;
  whenNotToUse: string;
}

type CatalogMeta = Pick<
  ToolCatalogEntry,
  "group" | "useCases" | "whenToUse" | "whenNotToUse"
>;

const CURATED: Record<string, CatalogMeta> = {
  page_digest: {
    group: "browser",
    useCases: [
      "Quick PDP/invoice map without full page dump",
      "Budget-mode first read before parse_data",
      "Detect EAN/catalog labels on product pages",
    ],
    whenToUse: "Need title, headings, and a short main sample — not nav chrome.",
    whenNotToUse: "Need full HTML, tables, or precise CSS extraction — use get_page/extract/query_all.",
  },
  scrape_pdps: {
    group: "agentic",
    useCases: [
      "Batch SAP/URL product pages in one tool turn",
      "Progressive EAN mapping with durable table upserts",
      "FoodWell-style /s/{sap} PDP enrichment",
    ],
    whenToUse: "Many product detail pages with a shared template; rows should persist each step.",
    whenNotToUse: "Single page or list/catalog pagination — use scrape_catalog or manual navigate+page_digest.",
  },
  ensure_scrape_table: {
    group: "data",
    useCases: [
      "Create durable scrape view before first PDP navigate",
      "Define columns + merge keys for progressive scraping",
    ],
    whenToUse: "Before any multi-step scrape that should survive tab closes or step limits.",
    whenNotToUse: "One-off CSV export with no incremental merge — export_csv/save_view may suffice.",
  },
  parse_data: {
    group: "agentic",
    useCases: [
      "Structure raw text or page snippets into JSON rows",
      "Cheap worker extraction after query_all/scrape_tables",
      "Invoice PDF text → product/EAN rows",
    ],
    whenToUse: "Have unstructured text and need typed rows without bloating orchestrator context.",
    whenNotToUse: "DOM fields are stable — prefer extract/query_all first; avoid re-parsing huge dumps.",
  },
  list_connectors: {
    group: "connectors",
    useCases: ["See which REST/MCP connectors are saved", "Check vault label refs before rest_request"],
    whenToUse: "Before rest_request when unsure a connector exists.",
    whenNotToUse: "You already know connectorId from ensure_github_connector.",
  },
  save_rest_connector: {
    group: "connectors",
    useCases: [
      "Register a REST host with vault Authorization ref",
      "Create github-rest / custom OpenAPI base without Settings UI",
    ],
    whenToUse: "Need a new connector and vault secret already exists as a label.",
    whenNotToUse: "GitHub PAT already in vault — prefer ensure_github_connector.",
  },
  ensure_github_connector: {
    group: "connectors",
    useCases: [
      "Bind api.github.com to github_token / github_pat / gh_combo_x",
      "Finish PAT embed → rest_request without Settings handoff",
    ],
    whenToUse: "User embedded a GitHub PAT; need github-rest before Contents/PR calls.",
    whenNotToUse: "Non-GitHub APIs — use save_rest_connector.",
  },
  rest_request: {
    group: "connectors",
    useCases: [
      "Call configured REST connector (GitHub, internal API)",
      "Fetch JSON via saved connector + vault secret refs",
    ],
    whenToUse: "Need server-side API data via a saved connector + vault secret refs.",
    whenNotToUse: "Data is only on the visible page — use browser tools first.",
  },
  web_search: {
    group: "browser",
    useCases: ["Current facts", "News", "Find public URLs"],
    whenToUse: "Need live web results without opening a tab first.",
    whenNotToUse: "Logged-in or JS-heavy pages — use navigate.",
  },
  web_fetch: {
    group: "browser",
    useCases: ["Read a public URL as text"],
    whenToUse: "After web_search, to skim a page without the browser.",
    whenNotToUse: "Need interactive DOM — use navigate + get_page.",
  },
  navigate: {
    group: "browser",
    useCases: ["Open a URL in the active tab", "Go to /s/{sap} PDP or login page"],
    whenToUse: "Default for all browsing. Prefer over open_tab.",
    whenNotToUse: "History back — use go_back. Parallel page only — open_tab with newTab:true.",
  },
  open_tab: {
    group: "browser",
    useCases: ["Rare: open a second tab to compare pages in parallel"],
    whenToUse: "Only with newTab:true when navigate cannot work (need two pages at once).",
    whenNotToUse: "Normal browsing — use navigate (open_tab without newTab already navigates).",
  },
  login: {
    group: "connectors",
    useCases: [
      "Authenticate with saved site profile",
      "One-shot login before scrape_catalog/scrape_pdps",
    ],
    whenToUse: "Credentials/selectors exist in vault profile or inline args.",
    whenNotToUse: "OAuth/CAPTCHA/2FA flows that need human approval beyond fill+click.",
  },
  remember: {
    group: "memory",
    useCases: [
      "Persist user preference or site quirk across sessions",
      "Store scrape recipe notes the orchestrator should recall later",
    ],
    whenToUse: "Fact should survive chat turns and be searchable via recall.",
    whenNotToUse: "Ephemeral step output — put in tool result or scrape table instead.",
  },
  ux_critique: {
    group: "media",
    useCases: [
      "Visual UX critique of the current page or a component",
      "Attach screenshot for vision without unlocking raw media tools",
    ],
    whenToUse: "User asks for design/UX feedback or a redesign mock — REQUIRED before answering.",
    whenNotToUse: "Text-only page facts — use page_digest.",
  },
  open_preview: {
    group: "meta",
    useCases: [
      "Show interactive HTML prototype inside chat",
      "Before/after image compare via attachmentIds",
    ],
    whenToUse: "Surface a table, HTML mock, or image without leaving chat.",
    whenNotToUse: "Only need a short text answer.",
  },
  annotate_screenshot: {
    group: "media",
    useCases: [
      "Numbered callouts on a captured screenshot",
      "Highlight hero/CTA/regions for UX findings",
    ],
    whenToUse: "After ux_critique — show markers matching critique numbers.",
    whenNotToUse: "No screenshot attachmentId yet.",
  },
  page_css_preview: {
    group: "media",
    useCases: ["Live ephemeral CSS tweak for before/after UX proof"],
    whenToUse: "Demonstrate a CSS fix on the live tab then re-capture.",
    whenNotToUse: "Permanent page changes — use page-ext instead.",
  },
  page_css_clear: {
    group: "media",
    useCases: ["Remove ephemeral Combo-X preview CSS"],
    whenToUse: "After before/after capture or when abandoning a CSS experiment.",
    whenNotToUse: "No preview CSS injected.",
  },
  screenshot_viewport: {
    group: "media",
    useCases: [
      "Capture visible tab for vision model or bug report",
      "Quick visual proof of UI state",
    ],
    whenToUse: "Need PNG of current viewport; user approved capture.",
    whenNotToUse: "Text fields suffice — prefer page_digest/extract to save tokens. Prefer ux_critique for UX feedback.",
  },
  upsert_scrape_rows: {
    group: "data",
    useCases: ["Merge PDP row after each successful scrape", "Incremental catalog enrichment"],
    whenToUse: "ensure_scrape_table already created; have matching column rows.",
    whenNotToUse: "No table yet — call ensure_scrape_table first.",
  },
  query_all: {
    group: "data",
    useCases: ["Batch extract product cards", "Collect EAN/href lists from list pages"],
    whenToUse: "Repeating DOM nodes share a CSS selector.",
    whenNotToUse: "Single field — use extract; full table — use scrape_tables.",
  },
  scrape_catalog: {
    group: "agentic",
    useCases: ["Paginated catalog scrape in one call", "List pages → parse_data → next page loop"],
    whenToUse: "Category/list pages with next-button pagination and stable card selector.",
    whenNotToUse: "Individual PDP fields — use scrape_pdps.",
  },
  get_page: {
    group: "browser",
    useCases: ["Read page text when digest is insufficient", "Structure mode for form layouts"],
    whenToUse: "Need snippet/structure text beyond page_digest.",
    whenNotToUse: "Budget mode full dump — rejected; prefer page_digest + parse_data.",
  },
  rag_search: {
    group: "memory",
    useCases: ["Codebase Q&A from granted folder", "Find file snippets by keyword"],
    whenToUse: "Local RAG index is granted and question is about repo/docs.",
    whenNotToUse: "Answer is on the live web page in front of you.",
  },
  recall: {
    group: "memory",
    useCases: ["Find prior notes by keyword", "Load user prefs saved via remember"],
    whenToUse: "Need durable memory, not current page content.",
    whenNotToUse: "Searching chat history — use search_sessions / get_session.",
  },
  search_sessions: {
    group: "meta",
    useCases: ["List recent chats", "Find a prior conversation by keyword"],
    whenToUse: "User asks about past chats or continuity across sessions.",
    whenNotToUse: "Need full message bodies — use get_session with the hit id.",
  },
  get_session: {
    group: "meta",
    useCases: ["Read messages from a past session id"],
    whenToUse: "After search_sessions, when titles/previews are not enough.",
    whenNotToUse: "Current open chat — use the live thread.",
  },
  export_session: {
    group: "meta",
    useCases: ["Download full transcript JSON/MD", "Publish conversation URL"],
    whenToUse: "User wants a file or shareable URL of the chat.",
    whenNotToUse: "Quick glance at one prior turn — use get_session.",
  },

  wait: {
    group: "browser",
    useCases: ["Settle after navigation or click", "Short delay before page_digest"],
    whenToUse: "SPA/network still loading after an action.",
    whenNotToUse: "Long polling — prefer explicit extract/find_text retry loop.",
  },
  list_tabs: {
    group: "browser",
    useCases: ["Find tab id for activate_tab", "Audit open pages before switching"],
    whenToUse: "Multi-tab workflow or wrong tab is active.",
    whenNotToUse: "Single-tab task — skip.",
  },
  mcp_call: {
    group: "connectors",
    useCases: ["Invoke remote MCP tool via configured connector"],
    whenToUse: "MCP connector configured and tool name known.",
    whenNotToUse: "Equivalent REST connector exists and is simpler.",
  },
};

const GROUP_DEFAULTS: Record<ToolGroup, Omit<CatalogMeta, "group">> = {
  browser: {
    useCases: ["Interact with the active browser tab"],
    whenToUse: "Goal requires DOM, navigation, or tab control.",
    whenNotToUse: "Task is API-only or local file/RAG — use connectors or rag_*.",
  },
  data: {
    useCases: ["Extract, transform, or export structured rows"],
    whenToUse: "Need tables, CSV, views, or structured scrape output.",
    whenNotToUse: "Only need a screenshot or one text field.",
  },
  media: {
    useCases: ["Capture screenshots or recordings"],
    whenToUse: "Visual evidence or vision input required.",
    whenNotToUse: "Text extraction is enough.",
  },
  memory: {
    useCases: ["Persist or retrieve local notes and RAG"],
    whenToUse: "Cross-session knowledge or indexed folder search.",
    whenNotToUse: "Data lives only on current page.",
  },
  connectors: {
    useCases: ["External APIs, MCP, or saved site profiles"],
    whenToUse: "Configured connector or vault profile applies.",
    whenNotToUse: "No connector/profile and page interaction suffices.",
  },
  agentic: {
    useCases: ["Multi-step automation with worker LLM assist"],
    whenToUse: "Compound workflows (catalog scrape, batch PDPs, parse_data).",
    whenNotToUse: "Single cheap browser read suffices.",
  },
  meta: {
    useCases: ["Session utilities, reminders, reports, RAG status"],
    whenToUse: "Auxiliary local ops not tied to one page read.",
    whenNotToUse: "Core task can be done with browser/data tools directly.",
  },
};

/** Static group assignment for tools without curated overrides. */
const TOOL_GROUP: Record<string, ToolGroup> = {
  get_page: "browser",
  page_digest: "browser",
  get_links: "browser",
  get_interactive: "browser",
  click_index: "browser",
  type_index: "browser",
  click: "browser",
  type_text: "browser",
  extract: "browser",
  scroll: "browser",
  wait: "browser",
  find_text: "browser",
  web_search: "browser",
  web_fetch: "browser",
  navigate: "browser",
  go_back: "browser",
  list_tabs: "browser",
  open_tab: "browser",
  activate_tab: "browser",
  close_tab: "browser",
  query_all: "data",
  scrape_tables: "data",
  export_csv: "data",
  save_view: "data",
  list_views: "data",
  get_view: "data",
  list_attachments: "data",
  read_attachment: "data",
  ensure_scrape_table: "data",
  upsert_scrape_rows: "data",
  get_scrape_table: "data",
  parse_data: "agentic",
  scrape_catalog: "agentic",
  scrape_pdps: "agentic",
  rag_search: "memory",
  rag_read_file: "memory",
  remember: "memory",
  save_memory: "memory",
  recall: "memory",
  memory_list: "memory",
  skill_search: "memory",
  skill_read: "memory",
  skill_save: "memory",
  save_site_profile: "connectors",
  get_site_profile: "connectors",
  login: "connectors",
  list_connectors: "connectors",
  save_rest_connector: "connectors",
  ensure_github_connector: "connectors",
  rest_request: "connectors",
  mcp_list_tools: "connectors",
  mcp_call: "connectors",
  ux_critique: "media",
  open_preview: "meta",
  annotate_screenshot: "media",
  page_css_preview: "media",
  page_css_clear: "media",
  screenshot_viewport: "media",
  screenshot_element: "media",
  screenshot_full: "media",
  start_recording: "media",
  stop_recording: "media",
  rag_status: "meta",
  save_bookmark: "meta",
  set_reminder: "meta",
  create_report: "meta",
  create_map_report: "meta",
  publish_upload: "connectors",
  search_sessions: "meta",
  get_session: "meta",
  export_session: "meta",
  list_custom_tools: "meta",
  custom_tool_save: "meta",
  create_agent: "agentic",
  update_agent: "agentic",
  list_agents: "agentic",
  spawn_subagent: "agentic",
  create_task: "meta",
  update_task: "meta",
  list_tasks: "meta",
  reorder_tasks: "meta",
  create_page_extension: "agentic",
  update_page_extension: "agentic",
  list_page_extensions: "agentic",
  get_page_extension: "agentic",
  approve_page_extension: "agentic",
  revoke_page_extension: "agentic",
  inject_page_extension: "agentic",
  set_page_extension_bridge: "agentic",
  page_ext_data_list: "agentic",
  page_ext_data_get: "agentic",
  page_ext_data_clear: "agentic",
  list_page_extension_audit: "agentic",
};

function metaFor(name: string): CatalogMeta {
  const curated = CURATED[name];
  if (curated) return curated;
  const group = TOOL_GROUP[name] ?? "meta";
  const defaults = GROUP_DEFAULTS[group];
  return { group, ...defaults };
}

function entryFromTool(tool: ToolDefinition): ToolCatalogEntry {
  const name = tool.function.name;
  const meta = metaFor(name);
  return {
    name,
    description: tool.function.description,
    ...meta,
  };
}

/** Full tool catalog derived from AGENT_TOOLS. */
export const TOOL_CATALOG: ToolCatalogEntry[] = AGENT_TOOLS.map(entryFromTool);

/** Lookup catalog entry by tool name. */
export function catalogEntry(name: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find((e) => e.name === name);
}

/** Filter AGENT_TOOLS to a name allowlist (preserves AGENT_TOOLS order). */
export function filterToolsByNames(names: string[]): ToolDefinition[] {
  const set = new Set(names);
  return AGENT_TOOLS.filter((t) => set.has(t.function.name));
}

/** Compact markdown catalog for worker/orchestrator prompts. */
export function catalogForPrompt(entries: ToolCatalogEntry[]): string {
  const byGroup = new Map<ToolGroup, ToolCatalogEntry[]>();
  for (const e of entries) {
    const list = byGroup.get(e.group) ?? [];
    list.push(e);
    byGroup.set(e.group, list);
  }
  const order: ToolGroup[] = [
    "browser",
    "data",
    "agentic",
    "memory",
    "connectors",
    "media",
    "meta",
  ];
  const lines: string[] = ["## Tool catalog", ""];
  for (const group of order) {
    const items = byGroup.get(group);
    if (!items?.length) continue;
    lines.push(`### ${group}`);
    for (const t of items) {
      lines.push(`- **${t.name}** — ${t.description}`);
      if (t.useCases.length) {
        lines.push(`  - Use: ${t.useCases.slice(0, 3).join("; ")}`);
      }
      lines.push(`  - When: ${t.whenToUse}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
