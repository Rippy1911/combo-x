import { RagStore, grantAndIndex, reindexSaved } from "@combo-x/core";

const TOOL_NAMES = [
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
  "export_csv",
  "save_bookmark",
  "set_reminder",
  "create_report",
  "search_sessions",
  "remember",
  "recall",
];

const TOOL_BLURB: Record<string, string> = {
  rag_search: "Search granted local folder index.",
  rag_read_file: "Read a path from the local RAG index.",
  rag_status: "Folder grant + index stats.",
  ideaforge_search: "Search IdeaForge knowledge (vault creds).",
  github_search_code: "GitHub code search (PAT).",
  github_get_file: "Read a GitHub file (PAT).",
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

const rag = new RagStore();

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

async function refreshRagStatus() {
  const el = document.getElementById("rag-status")!;
  const meta = await rag.getMeta();
  const handle = await rag.getHandle();
  if (!handle && !meta?.chunkCount) {
    el.textContent = "No folder granted yet.";
    return;
  }
  el.textContent = `${meta?.folderName || handle?.folderName || "folder"} — ${meta?.fileCount ?? 0} files / ${meta?.chunkCount ?? 0} chunks${
    meta?.indexedAt ? ` · ${new Date(meta.indexedAt).toLocaleString()}` : ""
  }`;
  const ragInput = document.getElementById("rag") as HTMLInputElement;
  if (!ragInput.value && meta?.folderName) ragInput.value = meta.folderName;
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

  document.getElementById("grant")!.addEventListener("click", async () => {
    const status = document.getElementById("rag-status")!;
    status.textContent = "Pick a folder…";
    try {
      const meta = await grantAndIndex(rag, (p) => {
        status.textContent = p.message ?? p.phase;
      });
      (document.getElementById("rag") as HTMLInputElement).value = meta.folderName;
      const local = document.querySelector<HTMLInputElement>('#connectors input[value="local_rag"]');
      if (local) local.checked = true;
      for (const name of ["rag_search", "rag_read_file", "rag_status"]) {
        const box = document.querySelector<HTMLInputElement>(`#tools input[value="${name}"]`);
        if (box) box.checked = true;
      }
      await refreshRagStatus();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  });

  document.getElementById("reindex")!.addEventListener("click", async () => {
    const status = document.getElementById("rag-status")!;
    status.textContent = "Reindexing…";
    try {
      await reindexSaved(rag, (p) => {
        status.textContent = p.message ?? p.phase;
      });
      await refreshRagStatus();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
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
  void refreshRagStatus();
}

render();
