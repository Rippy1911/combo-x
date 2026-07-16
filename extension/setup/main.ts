const TOOL_NAMES = [
  "get_page",
  "get_links",
  "click",
  "type_text",
  "extract",
  "scrape_tables",
  "remember",
  "recall",
  "list_tabs",
  "open_tab",
  "activate_tab",
  "export_csv",
  "save_bookmark",
  "set_reminder",
  "create_report",
  "search_sessions",
];

const TOOL_BLURB: Record<string, string> = {
  get_page: "Read active tab (title, url, text).",
  get_links: "List links on the page.",
  click: "Click an element (CSS selector).",
  type_text: "Type into an input (CSS selector).",
  extract: "Extract text/attribute from elements.",
  scrape_tables: "Scrape <table> rows into rows[][] for export.",
  remember: "Save a note to local memory.",
  recall: "Search local memory.",
  list_tabs: "List open tabs.",
  open_tab: "Open a URL in a new tab.",
  activate_tab: "Switch to a tab by id.",
  export_csv: "Download rows as CSV.",
  save_bookmark: "Save a bookmark.",
  set_reminder: "Set a reminder (ISO time).",
  create_report: "Build + download an HTML report.",
  search_sessions: "Search past chat sessions.",
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
  const ragPathHint = (document.getElementById("rag") as HTMLInputElement).value.trim() || null;
  const connectors = [...document.querySelectorAll<HTMLInputElement>("#connectors input")]
    .filter((c) => c.checked)
    .map((c) => c.value);
  return { type: "combo-x-setup", tools, approvalMode: approval, ragPathHint, connectors };
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

  // Pre-fill from existing storage so re-opening reflects current state.
  void chrome.storage.local.get("combo_x_setup_payload").then((res) => {
    const p = res.combo_x_setup_payload as SetupPayload | undefined;
    if (!p) return;
    if (Array.isArray(p.tools)) {
      document.querySelectorAll<HTMLInputElement>("#tools input").forEach((c) => {
        c.checked = p.tools.includes(c.value);
      });
    }
    if (p.approvalMode) (document.getElementById("approval") as HTMLSelectElement).value = p.approvalMode;
    if (p.ragPathHint) (document.getElementById("rag") as HTMLInputElement).value = p.ragPathHint;
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
      msg.textContent = `Sent — ${payload.tools.length} tools, approval=${payload.approvalMode}, connectors=${payload.connectors.length}. Open the Combo-X side panel.`;
    } catch (e) {
      msg.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  document.getElementById("close")!.addEventListener("click", () => window.close());
}

render();
