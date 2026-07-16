/**
 * Local episodic/semantic memory with cheap keyword scoring.
 * Combo Phase B aimed at pglite+pgvector — heavier, not wired.
 * Combo-X ships searchable memory that actually hooks into the agent day 1.
 */

export type MemoryKind = "episodic" | "semantic" | "note";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  createdAt: string;
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

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
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
  }): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      kind: input.kind ?? "note",
      text: input.text.trim(),
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };
    if (!entry.text) throw new Error("memory text must not be empty");
    await this.getDb();
    await idbReq(this.store("readwrite").put(entry));
    return entry;
  }

  async recall(query: string, limit = 5): Promise<MemoryEntry[]> {
    await this.getDb();
    const all = await idbReq<MemoryEntry[]>(this.store("readonly").getAll());
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return all
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
    }
    return all
      .map((e) => ({ ...e, score: scoreEntry(tokens, e) }))
      .filter((e) => (e.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  async list(limit = 50): Promise<MemoryEntry[]> {
    await this.getDb();
    const all = await idbReq<MemoryEntry[]>(this.store("readonly").getAll());
    return all
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
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
