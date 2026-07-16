/**
 * Agent task board — todo/doing/done/blocked with optional session scope.
 */

export type TaskStatus = "todo" | "doing" | "done" | "blocked";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
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
const DB_VERSION = 1;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("sessionId", "sessionId", { unique: false });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
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
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async put(input: Omit<Task, "createdAt" | "updatedAt"> & Partial<Pick<Task, "createdAt">>): Promise<Task> {
    if (!input.id?.trim()) throw new Error("task id required");
    if (!input.title?.trim()) throw new Error("task title required");
    await this.getDb();
    const now = new Date().toISOString();
    const existing =
      (await idbReq<Task | undefined>(this.store("readonly").get(input.id))) ?? null;
    const row: Task = {
      ...existing,
      ...input,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
    };
    await idbReq(this.store("readwrite").put(row));
    return row;
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
    const row: Task = { ...existing, status, updatedAt: new Date().toISOString() };
    await idbReq(this.store("readwrite").put(row));
    return row;
  }
}
