/**
 * Skills (playbooks). Name/description index is prepended each turn; full body via skill_read.
 * toolHints unlock SKILL_GATED tools for the current run after skill_read.
 */

import { TOOL_PACKS } from "../tools/gating.js";

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

export function seedSkillDefinitions(): Omit<Skill, "id" | "createdAt" | "updatedAt">[] {
  const nowTag = ["seed", "tools"];
  return [
    {
      name: "combo-scrape",
      description: "Progressive scrape tables, PDPs, catalog, login, CSV/views export",
      body: `SCRAPE PLAYBOOK
1) ensure_scrape_table with columns + merge keys BEFORE first navigate
2) Prefer scrape_pdps or scrape_catalog; else page_digest + upsert_scrape_rows per item
3) Never dump full get_page for multi-item scrapes
4) export_csv / save_view when done
5) Use login + site profile when credentials needed`,
      tags: [...nowTag, "scrape"],
      scope: "global",
      toolHints: [...TOOL_PACKS.scrape],
    },
    {
      name: "combo-rest",
      description: "Call REST and remote MCP connectors (vault secret refs)",
      body: `REST/MCP PLAYBOOK
- Use rest_request only against saved connectors
- mcp_list_tools then mcp_call; never invent hosts
- Secrets come from vault labels — do not echo secret values`,
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
- screenshot_viewport for quick vision; screenshot_full for long pages
- start_recording / stop_recording for demos
- Prefer page_digest when text is enough`,
      tags: [...nowTag, "media"],
      scope: "global",
      toolHints: [...TOOL_PACKS.media],
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
      if (all.length === 0) {
        const now = new Date().toISOString();
        for (const def of seedSkillDefinitions()) {
          const row: Skill = {
            ...def,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          };
          await idbReq(this.store("readwrite").put(row));
        }
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
    const row: Skill = {
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description.trim(),
      body: input.body,
      tags: input.tags ?? [],
      scope,
      agentId: scope === "agent" ? input.agentId!.trim() : undefined,
      toolHints: input.toolHints,
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
