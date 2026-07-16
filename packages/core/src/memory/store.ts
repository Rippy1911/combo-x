/**
 * Local episodic/semantic memory with cheap keyword scoring.
 * Combo Phase B aimed at pglite+pgvector — heavier, not wired.
 * Combo-X ships searchable memory that actually hooks into the agent day 1.
 *
 * Scopes: `global` (all agents) or `agent` (bound to an AgentProfile id).
 * Agent runs always prepend global + matching agent memories (once per turn).
 */

export type MemoryKind = "episodic" | "semantic" | "note";
export type MemoryScope = "global" | "agent";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  createdAt: string;
  /** Defaults to global for legacy rows. */
  scope: MemoryScope;
  /** Required when scope === "agent". */
  agentId?: string;
  score?: number;
}

export interface MemoryStoreOptions {
  dbName?: string;
  storeName?: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function scoreEntry(queryTokens: string[], entry: MemoryEntry): number {
  const hay = tokenize(`${entry.text} ${entry.tags.join(" ")}`);
  if (hay.length === 0 || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const q of queryTokens) {
    if (hay.includes(q)) hits += 1;
    else if (hay.some((h) => h.includes(q) || q.includes(h))) hits += 0.5;
  }
  const recencyBoost =
    1 + Math.max(0, 1 - (Date.now() - Date.parse(entry.createdAt)) / (1000 * 60 * 60 * 24 * 14));
  return (hits / queryTokens.length) * recencyBoost;
}

function normalizeEntry(raw: MemoryEntry): MemoryEntry {
  const scope: MemoryScope = raw.scope === "agent" ? "agent" : "global";
  return {
    ...raw,
    scope,
    agentId: scope === "agent" ? raw.agentId : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        const os = db.createObjectStore(storeName, { keyPath: "id" });
        os.createIndex("scope", "scope", { unique: false });
        os.createIndex("agentId", "agentId", { unique: false });
      } else {
        const tx = req.transaction;
        const os = tx?.objectStore(storeName);
        if (os && !os.indexNames.contains("scope")) {
          os.createIndex("scope", "scope", { unique: false });
        }
        if (os && !os.indexNames.contains("agentId")) {
          os.createIndex("agentId", "agentId", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("memory db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export class MemoryStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private db: IDBDatabase | null = null;

  constructor(options: MemoryStoreOptions = {}) {
    this.dbName = options.dbName ?? "combo_x_memory";
    this.storeName = options.storeName ?? "memories";
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName, this.storeName);
    return this.db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async remember(input: {
    text: string;
    kind?: MemoryKind;
    tags?: string[];
    scope?: MemoryScope;
    agentId?: string;
  }): Promise<MemoryEntry> {
    const scope: MemoryScope = input.scope === "agent" ? "agent" : "global";
    if (scope === "agent" && !input.agentId?.trim()) {
      throw new Error("agentId required when scope is agent");
    }
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      kind: input.kind ?? "note",
      text: input.text.trim(),
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
      scope,
      agentId: scope === "agent" ? input.agentId!.trim() : undefined,
    };
    if (!entry.text) throw new Error("memory text must not be empty");
    await this.getDb();
    await idbReq(this.store("readwrite").put(entry));
    return entry;
  }

  async recall(query: string, limit = 5, opts?: { agentId?: string }): Promise<MemoryEntry[]> {
    const candidates = await this.listForInject({
      agentId: opts?.agentId,
      limit: 500,
    });
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return candidates.slice(0, limit);
    }
    return candidates
      .map((e) => ({ ...e, score: scoreEntry(tokens, e) }))
      .filter((e) => (e.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  async list(limit = 50): Promise<MemoryEntry[]> {
    await this.getDb();
    const all = await idbReq<MemoryEntry[]>(this.store("readonly").getAll());
    return all
      .map(normalizeEntry)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  /**
   * Memories always prepended to each user turn: all global + agent-scoped for active agent.
   * Newest first within each bucket; global listed before agent.
   */
  async listForInject(opts: { agentId?: string; limit?: number } = {}): Promise<MemoryEntry[]> {
    const limit = opts.limit ?? 24;
    await this.getDb();
    const all = (await idbReq<MemoryEntry[]>(this.store("readonly").getAll())).map(normalizeEntry);
    const global = all
      .filter((e) => e.scope !== "agent")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const agentId = opts.agentId?.trim();
    const agentScoped = agentId
      ? all
          .filter((e) => e.scope === "agent" && e.agentId === agentId)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      : [];
    return [...global, ...agentScoped].slice(0, limit);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    await this.getDb();
    const row = await idbReq<MemoryEntry | undefined>(this.store("readonly").get(id));
    return row ? normalizeEntry(row) : null;
  }

  async update(
    id: string,
    patch: Partial<Pick<MemoryEntry, "text" | "tags" | "kind" | "scope" | "agentId">>,
  ): Promise<MemoryEntry> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`memory not found: ${id}`);
    const scope: MemoryScope =
      patch.scope === "agent" || patch.scope === "global" ? patch.scope : existing.scope;
    const agentId =
      scope === "agent" ? (patch.agentId ?? existing.agentId)?.trim() : undefined;
    if (scope === "agent" && !agentId) throw new Error("agentId required when scope is agent");
    const entry: MemoryEntry = {
      ...existing,
      text: patch.text != null ? patch.text.trim() : existing.text,
      tags: patch.tags ?? existing.tags,
      kind: patch.kind ?? existing.kind,
      scope,
      agentId,
    };
    if (!entry.text) throw new Error("memory text must not be empty");
    await idbReq(this.store("readwrite").put(entry));
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.getDb();
    await idbReq(this.store("readwrite").delete(id));
    return true;
  }

  async clear(): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").clear());
  }
}

/** Pure scoring helper for unit tests (no IDB). */
export function rankMemories(query: string, entries: MemoryEntry[], limit = 5): MemoryEntry[] {
  const tokens = tokenize(query);
  return entries
    .map((e) => ({ ...e, score: scoreEntry(tokens, e) }))
    .filter((e) => (e.score ?? 0) > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
