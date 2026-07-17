/**
 * Agent task board — todo/doing/done/blocked with optional session scope + sortOrder.
 */

export type TaskStatus = "todo" | "doing" | "done" | "blocked";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** Lower = higher priority. Backfilled on IDB v2 upgrade. */
  sortOrder: number;
  sessionId?: string | null;
  agentId?: string;
  parentTaskId?: string;
  note?: string;
  planMarkdown?: string;
  canvasRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskListOptions {
  sessionId?: string;
  status?: TaskStatus;
  /** When true, only tasks with sessionId null/undefined. */
  globalOnly?: boolean;
}

const DB_NAME = "combo_x_tasks";
const STORE = "tasks";
const DB_VERSION = 2;

export function compareTasksByOrder(a: Task, b: Task): number {
  const ao = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
  const bo = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function taskProgress(tasks: Task[]): { done: number; total: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return { done, total };
}

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("sessionId", "sessionId", { unique: false });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (oldVersion < 2) {
        const tx = req.transaction;
        if (!tx) return;
        const store = tx.objectStore(STORE);
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const rows = (getAllReq.result as Task[]).slice().sort((a, b) =>
            (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
          );
          rows.forEach((r, i) => {
            if (typeof r.sortOrder !== "number") {
              store.put({ ...r, sortOrder: i });
            }
          });
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("tasks db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export class TaskStore {
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

  async list(opts: TaskListOptions = {}): Promise<Task[]> {
    await this.getDb();
    let rows = await idbReq<Task[]>(this.store("readonly").getAll());
    if (opts.globalOnly) {
      rows = rows.filter((t) => t.sessionId == null);
    } else if (opts.sessionId !== undefined) {
      rows = rows.filter((t) => t.sessionId === opts.sessionId);
    }
    if (opts.status) rows = rows.filter((t) => t.status === opts.status);
    return rows
      .map((t) =>
        typeof t.sortOrder === "number" ? t : { ...t, sortOrder: Number.MAX_SAFE_INTEGER },
      )
      .sort(compareTasksByOrder);
  }

  /** Next sortOrder within session scope (`null` = global). */
  async nextSortOrder(sessionId: string | null): Promise<number> {
    const rows =
      sessionId == null
        ? await this.list({ globalOnly: true })
        : await this.list({ sessionId });
    let max = -1;
    for (const t of rows) {
      if (typeof t.sortOrder === "number" && t.sortOrder > max) max = t.sortOrder;
    }
    return max + 1;
  }

  async put(
    input: Omit<Task, "createdAt" | "updatedAt" | "sortOrder"> &
      Partial<Pick<Task, "createdAt" | "sortOrder">>,
  ): Promise<Task> {
    if (!input.id?.trim()) throw new Error("task id required");
    if (!input.title?.trim()) throw new Error("task title required");
    await this.getDb();
    const now = new Date().toISOString();
    const existing =
      (await idbReq<Task | undefined>(this.store("readonly").get(input.id))) ?? null;
    let sortOrder = input.sortOrder;
    if (typeof sortOrder !== "number") {
      sortOrder =
        typeof existing?.sortOrder === "number"
          ? existing.sortOrder
          : await this.nextSortOrder(input.sessionId ?? existing?.sessionId ?? null);
    }
    const row: Task = {
      ...existing,
      ...input,
      sortOrder,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
    };
    await idbReq(this.store("readwrite").put(row));
    return row;
  }

  /** Reassign sortOrder 0..n-1 for the given id sequence (ids not listed keep prior order). */
  async reorder(orderedIds: string[]): Promise<Task[]> {
    await this.getDb();
    const now = new Date().toISOString();
    const updated: Task[] = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]!;
      const existing = await idbReq<Task | undefined>(this.store("readonly").get(id));
      if (!existing) continue;
      const row: Task = {
        ...existing,
        sortOrder: i,
        updatedAt: now,
      };
      await idbReq(this.store("readwrite").put(row));
      updated.push(row);
    }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    await this.getDb();
    const existing = await idbReq<Task | undefined>(this.store("readonly").get(id));
    if (!existing) return false;
    await idbReq(this.store("readwrite").delete(id));
    return true;
  }

  async setStatus(id: string, status: TaskStatus): Promise<Task | null> {
    await this.getDb();
    const existing = await idbReq<Task | undefined>(this.store("readonly").get(id));
    if (!existing) return null;
    const row: Task = {
      ...existing,
      status,
      sortOrder: typeof existing.sortOrder === "number" ? existing.sortOrder : 0,
      updatedAt: new Date().toISOString(),
    };
    await idbReq(this.store("readwrite").put(row));
    return row;
  }
}
