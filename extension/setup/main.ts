const TOOL_NAMES = [
  "page_digest",
  "get_page",
  "get_links",
  "get_interactive",
  "click_index",
  "type_index",
  "click",
  "type_text",
  "extract",
  "query_all",
  "scrape_tables",
  "scroll",
  "wait",
  "find_text",
  "navigate",
  "go_back",
  "list_tabs",
  "open_tab",
  "activate_tab",
  "close_tab",
  "parse_data",
  "rag_search",
  "rag_read_file",
  "rag_status",
  "ideaforge_search",
  "github_search_code",
  "github_get_file",
  "list_attachments",
  "read_attachment",
  "export_csv",
  "save_view",
  "list_views",
  "get_view",
  "memory_list",
  "save_bookmark",
  "set_reminder",
  "create_report",
  "search_sessions",
  "remember",
  "recall",
];

const FOODWELL_PRESET = new Set([
  "page_digest",
  "get_page",
  "get_links",
  "get_interactive",
  "click_index",
  "type_index",
  "extract",
  "query_all",
  "find_text",
  "navigate",
  "go_back",
  "list_tabs",
  "open_tab",
  "activate_tab",
  "wait",
  "scroll",
  "parse_data",
  "list_attachments",
  "read_attachment",
  "export_csv",
  "save_view",
  "list_views",
  "get_view",
  "memory_list",
  "remember",
  "recall",
  "rag_search",
  "rag_read_file",
  "rag_status",
]);

const TOOL_BLURB: Record<string, string> = {
  page_digest: "Compact PDP map (EAN / carton / catalog) — prefer in Budget mode.",
  rag_search: "Search granted local folder index.",
  rag_read_file: "Read a path from the local RAG index.",
  rag_status: "Folder grant + index stats.",
  ideaforge_search: "Search IdeaForge knowledge (vault creds).",
  github_search_code: "GitHub code search (PAT).",
  github_get_file: "Read a GitHub file (PAT).",
  list_attachments: "List uploaded chat files.",
  read_attachment: "Read parsed text from an upload.",
  save_view: "Save table snapshot to Views tab.",
  list_views: "List saved Views.",
  get_view: "Load a saved View by id/name.",
  memory_list: "List durable local memories.",
  parse_data: "Cheap worker LLM structured extract.",
  get_interactive: "Indexed clickable/inputs snapshot.",
};

type SetupPayload = {
  type: "combo-x-setup";
  tools: string[];
  approvalMode: "ask" | "auto_llm" | "auto_all";
  ragPathHint: string | null;
  connectors: string[];
};

function readState(): SetupPayload {
  const tools = [...document.querySelectorAll<HTMLInputElement>("#tools input")]
    .filter((c) => c.checked)
    .map((c) => c.value);
  const approval = (document.getElementById("approval") as HTMLSelectElement).value as
    | "ask"
    | "auto_llm"
    | "auto_all";
  const connectors = [...document.querySelectorAll<HTMLInputElement>("#connectors input")]
    .filter((c) => c.checked)
    .map((c) => c.value);
  return { type: "combo-x-setup", tools, approvalMode: approval, ragPathHint: null, connectors };
}

function render() {
  const ul = document.getElementById("tools")!;
  for (const name of TOOL_NAMES) {
    const li = document.createElement("li");
    li.innerHTML = `<label><input type="checkbox" value="${name}" checked /> <strong>${name}</strong><br /><span class="hint">${TOOL_BLURB[name] ?? ""}</span></label>`;
    ul.appendChild(li);
  }
  document.getElementById("all-on")!.addEventListener("click", () => {
    document.querySelectorAll<HTMLInputElement>("#tools input").forEach((c) => (c.checked = true));
  });
  document.getElementById("all-off")!.addEventListener("click", () => {
    document.querySelectorAll<HTMLInputElement>("#tools input").forEach((c) => (c.checked = false));
  });
  document.getElementById("preset-foodwell")!.addEventListener("click", () => {
    document.querySelectorAll<HTMLInputElement>("#tools input").forEach((c) => {
      c.checked = FOODWELL_PRESET.has(c.value);
    });
    const approval = document.getElementById("approval") as HTMLSelectElement;
    approval.value = "auto_llm";
    document.querySelectorAll<HTMLInputElement>("#connectors input").forEach((c) => {
      c.checked = true;
    });
  });

  void chrome.storage.local.get("combo_x_setup_payload").then((res) => {
    const p = res.combo_x_setup_payload as SetupPayload | undefined;
    if (!p) return;
    if (Array.isArray(p.tools)) {
      document.querySelectorAll<HTMLInputElement>("#tools input").forEach((c) => {
        c.checked = p.tools.includes(c.value);
      });
    }
    if (p.approvalMode) (document.getElementById("approval") as HTMLSelectElement).value = p.approvalMode;
    if (Array.isArray(p.connectors)) {
      document.querySelectorAll<HTMLInputElement>("#connectors input").forEach((c) => {
        c.checked = p.connectors.includes(c.value);
      });
    }
  });

  document.getElementById("send")!.addEventListener("click", async () => {
    const payload = readState();
    const msg = document.getElementById("msg")!;
    try {
      await chrome.storage.local.set({ combo_x_setup_payload: payload });
      msg.textContent = `Sent — ${payload.tools.length} tools, approval=${payload.approvalMode}. Folder RAG stays in Settings. Open the Combo-X side panel.`;
    } catch (e) {
      msg.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  document.getElementById("close")!.addEventListener("click", () => window.close());
}

render();
