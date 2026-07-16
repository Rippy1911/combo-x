/**
 * Token/cost/tool usage telemetry in IndexedDB.
 */

export type UsageKind = "llm" | "tool" | "message";

export type MessageRole = "user" | "assistant" | "tool";

export interface UsageEvent {
  id: string;
  at: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  kind: UsageKind;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  tool?: string;
  role?: MessageRole;
}

export interface UsageListOptions {
  since?: string;
  until?: string;
  sessionId?: string;
  limit?: number;
}

export interface UsageTotals {
  events: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UsageAggregateRow {
  key: string;
  events: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

const DB_NAME = "combo_x_usage";
const STORE = "events";
const DB_VERSION = 1;

/** Parse OpenRouter model id "x-ai/grok-4.5" → provider "x-ai". */
export function providerFromModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "unknown";
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return trimmed;
  return trimmed.slice(0, slash);
}

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("at", "at", { unique: false });
        os.createIndex("sessionId", "sessionId", { unique: false });
        os.createIndex("kind", "kind", { unique: false });
        os.createIndex("model", "model", { unique: false });
        os.createIndex("provider", "provider", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("usage db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

function inRange(at: string, since?: string, until?: string): boolean {
  if (since && at < since) return false;
  if (until && at > until) return false;
  return true;
}

function sumRow(acc: UsageAggregateRow, e: UsageEvent): UsageAggregateRow {
  return {
    key: acc.key,
    events: acc.events + 1,
    promptTokens: acc.promptTokens + (e.promptTokens ?? 0),
    completionTokens: acc.completionTokens + (e.completionTokens ?? 0),
    totalTokens: acc.totalTokens + (e.totalTokens ?? 0),
    estimatedCostUsd: acc.estimatedCostUsd + (e.estimatedCostUsd ?? 0),
  };
}

function emptyRow(key: string): UsageAggregateRow {
  return {
    key,
    events: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
}

export class UsageStore {
  private db: IDBDatabase | null = null;

  constructor(private readonly dbName = DB_NAME) {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async append(input: Omit<UsageEvent, "id" | "at"> & { id?: string; at?: string }): Promise<UsageEvent> {
    const event: UsageEvent = {
      id: input.id ?? crypto.randomUUID(),
      at: input.at ?? new Date().toISOString(),
      ...input,
      provider:
        input.provider ??
        (input.model ? providerFromModel(input.model) : undefined),
    };
    await this.getDb();
    await idbReq(this.store("readwrite").put(event));
    return event;
  }

  async list(opts: UsageListOptions = {}): Promise<UsageEvent[]> {
    await this.getDb();
    const all = await idbReq<UsageEvent[]>(this.store("readonly").getAll());
    let rows = all.filter((e) => inRange(e.at, opts.since, opts.until));
    if (opts.sessionId) rows = rows.filter((e) => e.sessionId === opts.sessionId);
    rows.sort((a, b) => b.at.localeCompare(a.at));
    if (opts.limit != null && opts.limit >= 0) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async aggregateByModel(opts: UsageListOptions = {}): Promise<UsageAggregateRow[]> {
    const rows = await this.list({ ...opts, limit: undefined });
    const map = new Map<string, UsageAggregateRow>();
    for (const e of rows) {
      if (!e.model) continue;
      const cur = map.get(e.model) ?? emptyRow(e.model);
      map.set(e.model, sumRow(cur, e));
    }
    return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  }

  async aggregateByProvider(opts: UsageListOptions = {}): Promise<UsageAggregateRow[]> {
    const rows = await this.list({ ...opts, limit: undefined });
    const map = new Map<string, UsageAggregateRow>();
    for (const e of rows) {
      const key = e.provider ?? (e.model ? providerFromModel(e.model) : "unknown");
      const cur = map.get(key) ?? emptyRow(key);
      map.set(key, sumRow(cur, e));
    }
    return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  }

  async totals(opts: UsageListOptions = {}): Promise<UsageTotals> {
    const rows = await this.list({ ...opts, limit: undefined });
    return rows.reduce<UsageTotals>(
      (acc, e) => ({
        events: acc.events + 1,
        promptTokens: acc.promptTokens + (e.promptTokens ?? 0),
        completionTokens: acc.completionTokens + (e.completionTokens ?? 0),
        totalTokens: acc.totalTokens + (e.totalTokens ?? 0),
        estimatedCostUsd: acc.estimatedCostUsd + (e.estimatedCostUsd ?? 0),
      }),
      {
        events: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    );
  }

  async clear(): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").clear());
  }
}
