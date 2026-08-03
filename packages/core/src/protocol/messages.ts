import { z } from "zod";

/** Wire protocol between side panel ↔ service worker ↔ content script. */
export const PROTOCOL_VERSION = 1 as const;

export const BrowserToolNameSchema = z.enum([
  "get_page",
  "page_digest",
  "get_links",
  "click",
  "type_text",
  "extract",
  "scrape_tables",
  "scroll",
  "wait",
  "find_text",
  "get_interactive",
  "list_form_fields",
  "press_key",
  "click_index",
  "type_index",
  "query_all",
  "navigate",
  "go_back",
  "close_tab",
  "parse_data",
  "rag_search",
  "rag_read_file",
  "rag_status",
  "portfolio_ask",
  "portfolio_search",
  "mac_ui_tree",
  "mac_screenshot",
  "mac_click",
  "mac_type",
  "mac_key",
  "mac_apps",
  "mac_focus",
  "mac_list_dir",
  "mac_read_file",
  "index_dir",
  "ambient_recall",
  "list_attachments",
  "read_attachment",
  "remember",
  "save_memory",
  "recall",
  "memory_list",
  "skill_search",
  "skill_read",
  "skill_save",
  "list_tabs",
  "open_tab",
  "activate_tab",
  "export_csv",
  "save_view",
  "list_views",
  "get_view",
  "save_bookmark",
  "set_reminder",
  "create_report",
  "create_map_report",
  "publish_upload",
  "search_sessions",
  "get_session",
  "export_session",
  "login",
  "scrape_catalog",
  "save_site_profile",
  "get_site_profile",
  "ensure_scrape_table",
  "upsert_scrape_rows",
  "get_scrape_table",
  "scrape_pdps",
  "list_connectors",
  "save_rest_connector",
  "ensure_github_connector",
  "dispatch_cursor_agent",
  "rest_request",
  "mcp_list_tools",
  "mcp_call",
  "ux_critique",
  "open_preview",
  "annotate_screenshot",
  "page_css_preview",
  "page_css_clear",
  "screenshot_viewport",
  "screenshot_element",
  "screenshot_full",
  "start_recording",
  "stop_recording",
  "create_agent",
  "update_agent",
  "list_agents",
  "spawn_subagent",
  "create_task",
  "update_task",
  "list_tasks",
  "reorder_tasks",
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
]);
export type BrowserToolName = z.infer<typeof BrowserToolNameSchema>;

export const ContentRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("get_page"),
    maxChars: z.number().int().positive().max(50_000).optional(),
    mode: z.enum(["full", "snippet", "structure", "main"]).optional(),
    /** Character offset into the extracted text — page through long documents. */
    offset: z.number().int().min(0).max(5_000_000).optional(),
    /** Only return paragraphs containing this substring (case-insensitive). */
    filter: z.string().max(200).optional(),
    /** Drop lines containing this substring — strips repeated boilerplate. */
    exclude: z.string().max(200).optional(),
    /** CSS selector — prune matching subtrees before extraction (chat sidebars, cookie walls). */
    excludeSelector: z.string().max(300).optional(),
  }),
  z.object({ op: z.literal("page_digest") }),
  z.object({
    op: z.literal("get_links"),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
    filter: z.string().max(200).optional(),
    exclude: z.string().max(200).optional(),
    region: z.enum(["any", "main", "nav"]).optional(),
    /** Collapse links that share a href (nav repeated in a drawer + a header). */
    unique: z.boolean().optional(),
    /** `internal` = same origin as the page, `external` = off-site. */
    origin: z.enum(["any", "internal", "external"]).optional(),
    fields: z.array(z.enum(["text", "href", "region"])).max(3).optional(),
  }),
  z.object({ op: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    op: z.literal("type_text"),
    selector: z.string().min(1),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("extract"),
    selector: z.string().min(1),
    attribute: z.string().optional(),
  }),
  z.object({
    op: z.literal("scrape_tables"),
    selector: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  z.object({
    op: z.literal("scroll"),
    direction: z.enum(["up", "down", "top", "bottom", "percent"]),
    percent: z.number().min(0).max(100).optional(),
    selector: z.string().optional(),
  }),
  z.object({
    op: z.literal("wait"),
    ms: z.number().int().positive().max(10_000),
  }),
  z.object({
    op: z.literal("find_text"),
    text: z.string().min(1),
    scrollIntoView: z.boolean().optional(),
    limit: z.number().int().positive().max(50).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
    /** Chars of surrounding text to include per hit (0 = just the node text). */
    context: z.number().int().min(0).max(600).optional(),
    /** Keep only hits that sit inside a control — every one is click_index-able. */
    clickableOnly: z.boolean().optional(),
    region: z.enum(["any", "main", "nav"]).optional(),
    exclude: z.string().max(200).optional(),
    /** CSS selector — prune matching subtrees before scanning (chat sidebars). */
    excludeSelector: z.string().max(300).optional(),
  }),
  z.object({
    op: z.literal("get_interactive"),
    limit: z.number().int().positive().max(120).optional(),
    scope: z.enum(["auto", "page", "dialog"]).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
    /** Substring match (case-insensitive) over text/aria-label/name/placeholder/href. */
    filter: z.string().max(200).optional(),
    /** Drop controls matching this substring — kills icon-ligature noise. */
    exclude: z.string().max(200).optional(),
    /** Restrict to a control family. */
    kind: z.enum(["any", "link", "button", "input", "select"]).optional(),
    /** Restrict to page region — `main` drops nav/header/footer chrome. */
    region: z.enum(["any", "main", "nav"]).optional(),
    /** `enabled` hides controls that cannot be clicked yet. */
    state: z.enum(["any", "enabled", "disabled"]).optional(),
    /** Drop controls with no accessible name (bare icon buttons). */
    requireLabel: z.boolean().optional(),
    /** Project each item down to these keys — `i` is always kept. */
    fields: z
      .array(z.enum(["tag", "kind", "region", "role", "text", "href", "type", "placeholder", "name", "title", "disabled"]))
      .max(11)
      .optional(),
    /** CSS selector — prune matching subtrees before scanning (chat sidebars). */
    excludeSelector: z.string().max(300).optional(),
    /**
     * Row-scoping: keep only controls inside a row container that matches
     * `selector` and/or contains `text`. Indices stay absolute (click_index-safe).
     */
    within: z
      .object({
        selector: z.string().max(300).optional(),
        text: z.string().max(200).optional(),
      })
      .optional(),
  }),
  z.object({
    op: z.literal("list_form_fields"),
    limit: z.number().int().positive().max(200).optional(),
    region: z.enum(["any", "main", "nav"]).optional(),
    /** CSS selector — prune matching subtrees before scanning. */
    excludeSelector: z.string().max(300).optional(),
  }),
  z.object({
    op: z.literal("press_key"),
    key: z.enum(["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"]),
  }),
  z.object({
    op: z.literal("click_index"),
    index: z.number().int().nonnegative(),
  }),
  z.object({
    op: z.literal("type_index"),
    index: z.number().int().nonnegative(),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("query_all"),
    selector: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
    attributes: z.array(z.string()).optional(),
  }),
  z.object({
    op: z.literal("element_rect"),
    selector: z.string().min(1).optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ op: z.literal("page_metrics") }),
  z.object({
    op: z.literal("inject_css"),
    css: z.string().min(1).max(20_000),
  }),
  z.object({ op: z.literal("clear_css") }),
]);
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

export const ContentResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

export const RuntimeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content"),
    tabId: z.number().int().optional(),
    request: ContentRequestSchema,
  }),
  z.object({ type: z.literal("list_tabs") }),
  z.object({
    type: z.literal("open_tab"),
    url: z.string().url(),
    active: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("activate_tab"),
    tabId: z.number().int(),
  }),
  z.object({
    type: z.literal("navigate"),
    url: z.string().url(),
    tabId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("go_back"),
    tabId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("close_tab"),
    tabId: z.number().int(),
  }),
  z.object({
    type: z.literal("download_text"),
    filename: z.string().min(1),
    text: z.string(),
    mime: z.string().optional(),
  }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("capture_viewport"),
    windowId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("capture_element"),
    tabId: z.number().int(),
    selector: z.string().min(1).optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("capture_full_page"),
    tabId: z.number().int(),
  }),
  z.object({
    type: z.literal("start_recording"),
    tabId: z.number().int(),
  }),
  z.object({
    type: z.literal("stop_recording"),
    download: z.boolean().optional(),
    filename: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("inject_page_extensions"),
    tabId: z.number().int().optional(),
    scriptIds: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("page_ext_bridge"),
    kind: z.enum(["export", "storage_get", "storage_set", "storage_delete", "storage_list", "log"]),
    scriptId: z.string().min(1),
    bridgeToken: z.string().min(1),
    channel: z.string(),
    payload: z.unknown().optional(),
    reqId: z.string().optional(),
    pageUrl: z.string().optional(),
    tabId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("preview_frame"),
    tabId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("element_picker"),
    action: z.enum(["start", "stop"]),
    tabId: z.number().int().optional(),
  }),
]);
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;

export function getProtocolVersion(): number {
  return PROTOCOL_VERSION;
}

/** Tools that mutate the page / open URLs / handle credentials — require approval unless auto mode. */
export const SENSITIVE_TOOLS = new Set([
  "click",
  "type_text",
  "click_index",
  "type_index",
  "press_key",
  "open_tab",
  "activate_tab",
  "navigate",
  "go_back",
  "close_tab",
  "login",
  "scrape_catalog",
  "scrape_pdps",
  "rest_request",
  "mcp_call",
  "save_rest_connector",
  "ensure_github_connector",
  "dispatch_cursor_agent",
  "publish_upload",
  "start_recording",
  "stop_recording",
  "spawn_subagent",
  "create_page_extension",
  "update_page_extension",
  "approve_page_extension",
  "revoke_page_extension",
  "inject_page_extension",
  "set_page_extension_bridge",
  "page_ext_data_clear",
  "mac_click",
  "mac_type",
  "mac_key",
  "mac_focus",
  "mac_screenshot",
  "mac_read_file",
  "index_dir",
  "ambient_recall",
]);

/**
 * Never reachable from a spoken command: credential use, arbitrary HTTP/MCP with vault
 * placeholders, page-extension injection, and cloud dispatch. A misheard sentence must not
 * be able to spend money, exfiltrate a secret, or run injected JS.
 */
export const VOICE_FORBIDDEN_TOOLS = new Set([
  "login",
  "rest_request",
  "mcp_call",
  "save_rest_connector",
  "ensure_github_connector",
  "dispatch_cursor_agent",
  "publish_upload",
  "spawn_subagent",
  "create_page_extension",
  "update_page_extension",
  "approve_page_extension",
  "revoke_page_extension",
  "inject_page_extension",
  "set_page_extension_bridge",
]);

/** Schemes a voice-initiated navigation may never target. */
export const VOICE_FORBIDDEN_URL_SCHEMES = ["chrome:", "chrome-extension:", "file:", "about:", "devtools:"];
