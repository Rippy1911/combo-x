/**
 * Skills (playbooks). Name/description index is prepended each turn; full body via skill_read.
 * toolHints unlock SKILL_GATED tools for the current run after skill_read.
 */

import { TOOL_PACKS, isKnownTool } from "../tools/gating.js";

export type SkillScope = "global" | "agent";

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  tags: string[];
  scope: SkillScope;
  agentId?: string;
  toolHints?: string[];
  createdAt: string;
  updatedAt: string;
  score?: number;
}

export interface SkillStoreOptions {
  dbName?: string;
  storeName?: string;
  /** Skip seeding built-in packs (tests). */
  skipSeed?: boolean;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function scoreSkill(queryTokens: string[], skill: Skill): number {
  const hay = tokenize(
    `${skill.name} ${skill.description} ${skill.tags.join(" ")} ${skill.body.slice(0, 800)}`,
  );
  if (!hay.length || !queryTokens.length) return 0;
  let hits = 0;
  for (const q of queryTokens) {
    if (hay.includes(q)) hits += 1;
    else if (hay.some((h) => h.includes(q) || q.includes(h))) hits += 0.5;
  }
  return hits / queryTokens.length;
}

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        const os = db.createObjectStore(storeName, { keyPath: "id" });
        os.createIndex("name", "name", { unique: false });
        os.createIndex("scope", "scope", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("skills db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

/** Bump when a seed body/toolHints must refresh existing IDB rows. */
export const SEED_REVISION = "v1.6.42";

/**
 * Playbook-only seeds (empty toolHints) rewritten when revision advances.
 * Pack seeds with toolHints always refresh when SEED_REVISION is missing —
 * otherwise skill_read keeps stale unlocks (e.g. combo-rest stuck at 3 tools
 * while TOOL INDEX lists ensure_github_connector).
 */
const SEED_FORCE_REFRESH = new Set([
  "combo-ux-critique",
  "combo-tasks",
  "combo-vault-setup",
]);

export function seedSkillDefinitions(): Omit<Skill, "id" | "createdAt" | "updatedAt">[] {
  const nowTag = ["seed", "tools", SEED_REVISION];
  return [
    {
      name: "combo-scrape",
      description: "Progressive scrape tables, PDPs, catalog, login, CSV/views export",
      body: `SCRAPE PLAYBOOK
1) ensure_scrape_table with columns + merge keys BEFORE first navigate
2) Order/product CSV attachments: parse_data({ attachmentId, intent: "every product name + SAP/index" }) — NEVER paste the truncated chat preview into text=
3) Prefer scrape_pdps or scrape_catalog; else page_digest + upsert_scrape_rows per item
4) Never dump full get_page for multi-item scrapes
5) export_csv / save_view when done
6) Use login + site profile when credentials needed`,
      tags: [...nowTag, "scrape"],
      scope: "global",
      toolHints: [...TOOL_PACKS.scrape],
    },
    {
      name: "combo-rest",
      description: "Call REST and remote MCP connectors (vault secret refs)",
      body: `REST/MCP PLAYBOOK
- list_connectors to see saved ids (vault refs only, no secret values)
- Missing GitHub: ensure_github_connector (binds github_token|github_pat|gh_combo_x → github-rest)
- Other hosts: save_rest_connector({ id, baseUrl, authVaultLabel }) — never plaintext PATs
- Then rest_request({ connectorId, method, path, … })
- mcp_list_tools then mcp_call; never invent hosts
- Secrets stay as vault labels — do not echo secret values`,
      tags: [...nowTag, "rest", "mcp"],
      scope: "global",
      toolHints: [...TOOL_PACKS.rest],
    },
    {
      name: "combo-rag",
      description: "Search local folder knowledge base and attachments",
      body: `RAG PLAYBOOK
- rag_status to confirm index
- rag_search then rag_read_file for snippets
- list_attachments / read_attachment for chat files`,
      tags: [...nowTag, "rag", "knowledge"],
      scope: "global",
      toolHints: [...TOOL_PACKS.rag],
    },
    {
      name: "combo-page-ext",
      description: "MAIN-world page extensions, inject, bridge data",
      body: `PAGE EXTENSION PLAYBOOK
- create_page_extension → user approve → inject_page_extension
- Bridge data via page_ext_data_*; never store passwords in page-ext storage
- Prefer Vault + login for credentials`,
      tags: [...nowTag, "page-ext"],
      scope: "global",
      toolHints: [...TOOL_PACKS["page-ext"]],
    },
    {
      name: "combo-media",
      description: "Screenshots and tab recording",
      body: `MEDIA PLAYBOOK
- Prefer ux_critique for UX feedback (always-on; no skill unlock needed)
- screenshot_viewport for quick vision; screenshot_full for long pages
- start_recording / stop_recording for demos
- Prefer page_digest when text is enough
- Screenshots are vision-attached by the runtime — tool results are stubs (attachmentId), not base64`,
      tags: [...nowTag, "media"],
      scope: "global",
      toolHints: [...TOOL_PACKS.media],
    },
    {
      name: "combo-ux-critique",
      description: "Visual UX critique + annotated screenshots + live CSS before/after",
      body: `UX VISION LAB PLAYBOOK (MANDATORY for visual UX audits)

NEVER answer a visual UX audit from get_page / get_links alone.

1) navigate to the target URL (or confirm active tab)
2) ux_critique({ scope:"viewport"|"full"|"element", focus? }) — REQUIRED
   - Shows a screenshot artifact in chat
   - Returns stub { attachmentId } — save that id
   - Image is vision-attached for the NEXT model turn
3) On the turn after vision: critique with rubric (hierarchy, contrast, CTA, density, mobile, a11y, copy)
   - Number findings 1..N
4) annotate_screenshot({ attachmentId, title, markers:[{x,y,label,note}] })
   - x/y are percent 0–100; labels must match finding numbers
5) Propose fixes / full report:
   a) open_preview({ kind:"html", title, html, interactive:true, attachmentIds:[…] })
      — embed shots with <img src="attachment:UUID"> (UUID from ux_critique stubs)
      — prefer CSS-only UI (details/summary, radio+:checked, :target); JS may be sandboxed
   b) create_report({ title, bodyHtml, attachmentIds }) — downloads + opens preview
   c) Live proof: page_css_preview → ux_critique → compare → page_css_clear
6) Never paste base64 — always attachmentId / attachment:UUID / beforeAttachmentId
7) Do NOT unlock combo-media unless you need raw screenshot_* / recording`,
      tags: [...nowTag, "ux", "vision", "design"],
      scope: "global",
      // ALWAYS_ON: ux_critique, open_preview, annotate_screenshot, page_css_*
      toolHints: [],
    },
    {
      name: "combo-tasks",
      description: "Plan work with conversation tasks (session checklist + global backlog)",
      body: `TASKS PLAYBOOK
- For multi-step work in this chat: create_task (defaults to this session). One task per discrete deliverable; short titles.
- Set status=doing on the active item; update_task status=done when a step finishes — never invent completion.
- list_tasks to inspect; reorder_tasks({ orderedIds }) to set priority (first = top).
- Global backlog: create_task with sessionId omitted only when work is cross-chat; prefer session tasks for a plan.
- Tools are always-on — no pack unlock needed. Operator sees Conversation Tasks drawer in Chat.`,
      tags: [...nowTag, "tasks", "planning"],
      scope: "global",
      toolHints: [],
    },
    {
      name: "combo-memory",
      description: "Durable notes, bookmarks, reminders, and session search",
      body: `MEMORY PLAYBOOK
- remember / save_memory for facts that should survive turns (scope global|agent)
- recall / memory_list before inventing user preferences
- search_sessions (empty query = recent) + get_session for prior chats; save_bookmark / set_reminder / create_report for artifacts
- Tools are always-on — no pack unlock needed`,
      tags: [...nowTag, "memory", "notes"],
      scope: "global",
      toolHints: [],
    },
    {
      name: "combo-subagent",
      description: "Delegate focused sub-goals to an isolated worker agent",
      body: `SUBAGENT PLAYBOOK
- spawn_subagent with a narrow goal; parent only receives the summary
- list_agents / create_agent / update_agent for reusable profiles (when canSelfEdit)
- Depth is capped at 1 — do not nest further
- Tools are always-on when in the tool ceiling`,
      tags: [...nowTag, "agents", "delegate"],
      scope: "global",
      toolHints: [],
    },
    {
      name: "combo-vault-setup",
      description: "First-run vault: passphrase, OpenRouter key, optional GitHub/uploads/food tokens",
      body: `VAULT SETUP PLAYBOOK
1) User sets a passphrase in Settings (UI) — never ask them to paste it in chat
2) Save openrouter_api_key + openrouter_model via Settings → Vault / API keys
3) Optional vault labels + Settings → Connectors templates:
   - github_token → GitHub REST
   - fc_uploads_key (fcu_*) → NS Uploads (protected tier; public publish_upload needs no key)
   - ns_food_key (nsk_*) → NS Food (search/product/autocomplete via rest_request)
4) Lock vault when done; secrets stay AES-GCM encrypted locally
5) Do not echo secret values in tool args or replies`,
      tags: [...nowTag, "vault", "onboarding"],
      scope: "global",
      toolHints: [],
    },
    {
      name: "combo-map",
      description: "Plot lat/lng markers on OpenFreeMap PL/EN basemap and share via uploads",
      body: `MAP PLAYBOOK
1) Collect markers as {lat, lng, label?, note?} (from scrape rows, Nominatim, or user)
2) create_map_report({ title, markers, locale: "pl"|"en" }) — opens interactive MapLibre preview (style inlined; tiles from OpenFreeMap)
3) To share: publish_upload({ filename: "map.html", reportId: <id from step 2> }) → file_url on uploads.nextsolutions.studio
4) Prefer publish_upload over chrome-extension:// links (CORS + shareability)
5) Do NOT invent coordinates; geocode via a REST connector or ask the user
6) skill_read this skill for the playbook (tools are always-on)`,
      tags: [...nowTag, "map", "geo", "uploads"],
      scope: "global",
      toolHints: [],
    },
    {
      name: "combo-uploads",
      description: "Publish HTML reports, maps, CSV to uploads.nextsolutions.studio",
      body: `UPLOADS PLAYBOOK
- publish_upload({ filename, text }) for ad-hoc HTML/CSV/JSON
- publish_upload({ filename, reportId }) after create_report / create_map_report
- publish_upload({ filename, attachmentId }) for chat files (images/PDF when dataUrl present)
- Public tier (default): no API key; workspace/app = combo-x → https://uploads…/f/<sha>.<ext>
- Protected tier: Settings → Add NS Uploads template + vault fc_uploads_key → publish_upload({ connectorId: "ns-uploads", … })
- openTab defaults true — share the returned file_url
- Never echo vault secrets; uploads are world-readable on public tier — do not upload passwords`,
      tags: [...nowTag, "uploads", "cdn", "share"],
      scope: "global",
      toolHints: [],
    },
    {
      name: "combo-ns-food",
      description: "Enrich scrapes with ns-food macros / barcode lookup via REST connector",
      body: `NS-FOOD PLAYBOOK
1) Settings → Vault label ns_food_key (nsk_…) + Connectors → Add NS Food template (id ns-food)
2) skill_read combo-ns-food (or combo-rest) to unlock rest_request if gated
3) Search: rest_request({ connectorId:"ns-food", method:"GET", path:"/v1/search", query:{ q, locale:"pl", page_size:"10" } })
4) Barcode: rest_request({ connectorId:"ns-food", method:"GET", path:"/v1/product/"+ean })
5) Autocomplete: path /v1/autocomplete ?q=&locale=
6) Merge macros into Views via upsert_scrape_rows / save_view — never invent nutrition
7) Alternate without nsk_: anatome.nextsolutions.studio /v1/food/* (anon, rate-limited)`,
      tags: [...nowTag, "food", "nutrition", "rest"],
      scope: "global",
      toolHints: [...TOOL_PACKS.rest],
    },
    {
      name: "combo-pdf-attach",
      description: "Use chat attachments (PDF/CSV/XLSX/images) with parse_data",
      body: `ATTACHMENTS PLAYBOOK
- User attaches files via the paperclip; images are vision-attached on send
- list_attachments / read_attachment for text extracts (unlock via skill_read combo-rag if locked)
- parse_data (always-on worker) for structured rows from messy text
- Prefer save_view / export_csv after parse when the user wants a table`,
      tags: [...nowTag, "attachments", "pdf", "sheets"],
      scope: "global",
      // Avoid double-unlocking TOOL_PACKS.rag — point users at combo-rag for attach tools
      toolHints: [],
    },
    {
      name: "combo-openapi-call",
      description: "Call APIs using a saved OpenAPI-aware REST connector",
      body: `OPENAPI PLAYBOOK
1) save_rest_connector({ id, baseUrl, authVaultLabel }) or Settings → Connectors
2) Prefer rest_request with paths/methods that match the OpenAPI operations the user described
3) Never invent hosts; never echo secret values
4) For MCP servers use mcp_list_tools → mcp_call instead
5) skill_read this skill unlocks rest/mcp tools (same pack as combo-rest)`,
      tags: [...nowTag, "openapi", "rest", "api"],
      scope: "global",
      toolHints: [...TOOL_PACKS.rest],
    },
    {
      name: "combo-repo-ops",
      description: "Open PRs on Rippy1911/combo-x via GitHub REST + vault PAT",
      body: `COMBO REPO OPS (self-edit via GitHub API — not local filesystem)

SETUP (once — agent can finish after PAT is in vault):
1) User creates a fine-grained GitHub PAT scoped to Rippy1911/combo-x (Contents R/W, Pull requests R/W, Metadata R) — do NOT automate PAT creation in the GitHub UI
2) Embed/save PAT to vault as github_pat, github_token, or gh_combo_x (never echo it)
3) skill_read combo-repo-ops (unlocks rest pack) → ensure_github_connector → rest_request
   (ensure_github_connector creates github-rest → api.github.com; no Settings handoff)

BRANCH + FILE CHANGE (Contents API via rest_request connectorId=github-rest):
1) GET /repos/Rippy1911/combo-x/git/ref/heads/main → commit sha
2) POST /repos/Rippy1911/combo-x/git/refs { ref:"refs/heads/combo-x/<short>", sha }
3) GET /repos/Rippy1911/combo-x/contents/<path>?ref=<branch> → sha + base64 content
4) PUT /repos/Rippy1911/combo-x/contents/<path> with message, content (base64), sha, branch
5) POST /repos/Rippy1911/combo-x/pulls { title, head, base:"main", body }

RULES:
- One branch per change; never force-push main
- Never print the token; use vault refs only
- Prefer small focused PRs; operator reviews/merges
- After merge: operator rebuilds extension (pnpm build) and reloads`,
      tags: [...nowTag, "github", "repo", "rest", "self-edit"],
      scope: "global",
      toolHints: [...TOOL_PACKS.rest],
    },
  ];
}

export class SkillStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly skipSeed: boolean;
  private db: IDBDatabase | null = null;
  private seeded = false;

  constructor(options: SkillStoreOptions = {}) {
    this.dbName = options.dbName ?? "combo_x_skills";
    this.storeName = options.storeName ?? "skills";
    this.skipSeed = options.skipSeed ?? false;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName, this.storeName);
    return this.db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  private async ensureSeed(): Promise<void> {
    if (this.seeded) return;
    await this.getDb();
    if (!this.skipSeed) {
      const all = await idbReq<Skill[]>(this.store("readonly").getAll());
      const byName = new Map(all.map((s) => [s.name, s]));
      const now = new Date().toISOString();
      for (const def of seedSkillDefinitions()) {
        const existing = byName.get(def.name);
        if (!existing) {
          const row: Skill = {
            ...def,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          };
          await idbReq(this.store("readwrite").put(row));
          continue;
        }
        const isSeed = (existing.tags ?? []).includes("seed");
        const staleRevision = !(existing.tags ?? []).includes(SEED_REVISION);
        const hasPackHints = (def.toolHints?.length ?? 0) > 0;
        const needsRefresh =
          isSeed &&
          staleRevision &&
          (SEED_FORCE_REFRESH.has(def.name) || hasPackHints);
        if (!needsRefresh) continue;
        const row: Skill = {
          ...existing,
          description: def.description,
          body: def.body,
          tags: def.tags ?? existing.tags,
          toolHints: def.toolHints,
          updatedAt: now,
        };
        await idbReq(this.store("readwrite").put(row));
      }
    }
    this.seeded = true;
  }

  async save(input: {
    id?: string;
    name: string;
    description: string;
    body: string;
    tags?: string[];
    scope?: SkillScope;
    agentId?: string;
    toolHints?: string[];
  }): Promise<Skill> {
    await this.ensureSeed();
    const scope: SkillScope = input.scope === "agent" ? "agent" : "global";
    if (scope === "agent" && !input.agentId?.trim()) {
      throw new Error("agentId required when scope is agent");
    }
    const now = new Date().toISOString();
    const existing = input.id ? await this.get(input.id) : null;
    // Drop toolHints that don't map to a real, routable tool so a skill can never
    // "unlock" a non-existent capability (silent no-op / confusing to the model).
    const toolHints = input.toolHints?.filter(isKnownTool);
    const row: Skill = {
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description.trim(),
      body: input.body,
      tags: input.tags ?? [],
      scope,
      agentId: scope === "agent" ? input.agentId!.trim() : undefined,
      toolHints,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (!row.name) throw new Error("skill name required");
    await idbReq(this.store("readwrite").put(row));
    return row;
  }

  async get(id: string): Promise<Skill | null> {
    await this.ensureSeed();
    return (await idbReq<Skill | undefined>(this.store("readonly").get(id))) ?? null;
  }

  /**
   * Exact name match. Prefers global over agent-scoped when both exist.
   * Used when models pass seed names (e.g. combo-scrape) as skill_read id.
   */
  async getByName(name: string, opts: { agentId?: string } = {}): Promise<Skill | null> {
    const needle = name.trim();
    if (!needle) return null;
    const candidates = await this.list({ agentId: opts.agentId, limit: 500 });
    const matches = candidates.filter((s) => s.name === needle);
    if (!matches.length) return null;
    return matches.find((s) => s.scope === "global") ?? matches[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureSeed();
    const existing = await this.get(id);
    if (!existing) return false;
    await idbReq(this.store("readwrite").delete(id));
    return true;
  }

  async list(opts: { agentId?: string; limit?: number } = {}): Promise<Skill[]> {
    await this.ensureSeed();
    const limit = opts.limit ?? 100;
    const all = await idbReq<Skill[]>(this.store("readonly").getAll());
    const agentId = opts.agentId?.trim();
    const filtered = all.filter((s) => {
      if (s.scope !== "agent") return true;
      return !!agentId && s.agentId === agentId;
    });
    return filtered
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async search(
    query: string,
    opts: { agentId?: string; limit?: number } = {},
  ): Promise<Skill[]> {
    const candidates = await this.list({ agentId: opts.agentId, limit: 500 });
    const tokens = tokenize(query);
    const limit = opts.limit ?? 8;
    if (!tokens.length) return candidates.slice(0, limit);
    return candidates
      .map((s) => ({ ...s, score: scoreSkill(tokens, s) }))
      .filter((s) => (s.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }
}
