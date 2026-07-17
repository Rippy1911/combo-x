/**
 * Delta log for Views/table mutations (add / update / replace / delete).
 */

export type ChangeOp = "add" | "update" | "replace" | "delete_view" | "mixed";

export interface ChangeLogEntry {
  id: string;
  at: string;
  viewId: string;
  viewName: string;
  op: ChangeOp;
  added: number;
  updated: number;
  removed: number;
  sampleKeys?: string[];
  sourceTool?: string;
  sessionId?: string | null;
}

export interface UpsertDelta {
  added: number;
  updated: number;
  removed: number;
  sampleKeys: string[];
  op: ChangeOp;
}

const DB_NAME = "combo_x_change_log";
const STORE = "changes";
const DB_VERSION = 1;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("at", "at", { unique: false });
        os.createIndex("viewId", "viewId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("change log db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export class ChangeLogStore {
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

  async append(
    input: Omit<ChangeLogEntry, "id" | "at"> & { id?: string; at?: string },
  ): Promise<ChangeLogEntry> {
    await this.getDb();
    const row: ChangeLogEntry = {
      id: input.id ?? crypto.randomUUID(),
      at: input.at ?? new Date().toISOString(),
      viewId: input.viewId,
      viewName: input.viewName,
      op: input.op,
      added: input.added,
      updated: input.updated,
      removed: input.removed,
      sampleKeys: input.sampleKeys,
      sourceTool: input.sourceTool,
      sessionId: input.sessionId ?? null,
    };
    await idbReq(this.store("readwrite").put(row));
    return row;
  }

  async list(limit = 80): Promise<ChangeLogEntry[]> {
    await this.getDb();
    const rows = await idbReq<ChangeLogEntry[]>(this.store("readonly").getAll());
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  async clear(): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").clear());
  }
}

/** Compare pre/post key sets for upsertRows. */
export function computeUpsertDelta(
  beforeKeys: Set<string>,
  afterKeys: Set<string>,
  touchedKeys: string[],
): UpsertDelta {
  let added = 0;
  let updated = 0;
  for (const k of touchedKeys) {
    if (beforeKeys.has(k)) updated += 1;
    else added += 1;
  }
  let removed = 0;
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) removed += 1;
  }
  const op: ChangeOp =
    added && updated
      ? "mixed"
      : added
        ? "add"
        : updated
          ? "update"
          : removed
            ? "mixed"
            : "update";
  return {
    added,
    updated,
    removed,
    sampleKeys: touchedKeys.slice(0, 8),
    op,
  };
}
