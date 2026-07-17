/**
 * Per-action "Always Allow" policies (tool ± optional target).
 * Distinct from approvalMode auto_all (whole execution).
 */

export interface ApprovalPolicy {
  id: string;
  tool: string;
  /** null = allow this tool for any args; set = fingerprint match required */
  targetKey: string | null;
  createdAt: string;
}

const DB_NAME = "combo_x_approval_policies";
const STORE = "policies";
const DB_VERSION = 1;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("tool", "tool", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("approval policy db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

/** Stable target fingerprint from common tool args (url / selector / index+text). */
export function targetKeyFromArgs(
  _tool: string,
  args: Record<string, unknown>,
): string | null {
  if (typeof args.url === "string" && args.url.trim()) {
    return `url:${args.url.trim()}`;
  }
  if (typeof args.selector === "string" && args.selector.trim()) {
    return `sel:${args.selector.trim()}`;
  }
  if (typeof args.index === "number" && Number.isFinite(args.index)) {
    const text =
      typeof args.text === "string" ? args.text.trim().slice(0, 120) : "";
    return text ? `idx:${args.index}:${text}` : `idx:${args.index}`;
  }
  return null;
}

export function policyMatches(
  policies: ApprovalPolicy[],
  tool: string,
  args: Record<string, unknown>,
): ApprovalPolicy | null {
  const target = targetKeyFromArgs(tool, args);
  const forTool = policies.filter((p) => p.tool === tool);
  // Prefer exact target match, then tool-wide (targetKey null).
  if (target) {
    const exact = forTool.find((p) => p.targetKey === target);
    if (exact) return exact;
  }
  return forTool.find((p) => p.targetKey == null) ?? null;
}

export class ApprovalPolicyStore {
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

  async list(): Promise<ApprovalPolicy[]> {
    await this.getDb();
    const rows = await idbReq<ApprovalPolicy[]>(this.store("readonly").getAll());
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remember(tool: string, targetKey: string | null): Promise<ApprovalPolicy> {
    await this.getDb();
    const existing = (await this.list()).find(
      (p) => p.tool === tool && p.targetKey === targetKey,
    );
    if (existing) return existing;
    const row: ApprovalPolicy = {
      id: crypto.randomUUID(),
      tool,
      targetKey,
      createdAt: new Date().toISOString(),
    };
    await idbReq(this.store("readwrite").put(row));
    return row;
  }

  async forget(id: string): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").delete(id));
  }

  async allows(tool: string, args: Record<string, unknown>): Promise<boolean> {
    const rows = await this.list();
    return policyMatches(rows, tool, args) != null;
  }
}
