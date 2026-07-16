/**
 * Persisted chat sessions (IndexedDB). Searchable by title + message text.
 */

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  /** Operator starred this turn for later reference */
  bookmarked?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  /** Expandable tool chips attached to this turn */
  tools?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "running" | "done" | "denied" | "error";
  }>;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  totalTokens: number;
  estimatedCostUsd: number;
  /** Operator starred this conversation */
  bookmarked?: boolean;
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("sessions db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export class SessionStore {
  private db: IDBDatabase | null = null;
  constructor(private readonly dbName = "combo_x_sessions") {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction("sessions", mode).objectStore("sessions");
  }

  async create(title = "New chat"): Promise<ChatSession> {
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
    await this.getDb();
    await idbReq(this.store("readwrite").put(session));
    return session;
  }

  async get(id: string): Promise<ChatSession | null> {
    await this.getDb();
    return (await idbReq<ChatSession | undefined>(this.store("readonly").get(id))) ?? null;
  }

  async save(session: ChatSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.getDb();
    await idbReq(this.store("readwrite").put(session));
  }

  async list(limit = 50): Promise<ChatSession[]> {
    await this.getDb();
    const all = await idbReq<ChatSession[]>(this.store("readonly").getAll());
    return all
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  async search(query: string, limit = 10): Promise<ChatSession[]> {
    const tokens = tokenize(query);
    const all = await this.list(200);
    if (tokens.length === 0) return all.slice(0, limit);
    return all
      .map((s) => {
        const hay = tokenize(
          `${s.title} ${s.messages.map((m) => m.content).join(" ")}`.slice(0, 20_000),
        );
        let hits = 0;
        for (const t of tokens) if (hay.includes(t)) hits += 1;
        return { s, score: hits / tokens.length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.s);
  }

  async delete(id: string): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").delete(id));
  }
}
