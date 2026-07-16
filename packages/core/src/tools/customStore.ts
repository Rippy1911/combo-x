/**
 * User-defined tools — schemas merged into the LLM tools list.
 * kind "guide": returns handlerNote (playbook stub).
 * kind "echo": returns args + handlerNote (for testing / structured handoff).
 */

export type CustomToolKind = "guide" | "echo";

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  /** JSON Schema object for function.parameters */
  parameters: Record<string, unknown>;
  kind: CustomToolKind;
  /** Returned when the agent calls the tool (guide/echo). */
  handlerNote?: string;
  createdAt: string;
  updatedAt: string;
}

const DB_NAME = "combo_x_custom_tools";
const STORE = "custom_tools";
const DB_VERSION = 1;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("name", "name", { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("custom tools db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

export class CustomToolStore {
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

  async list(): Promise<CustomTool[]> {
    await this.getDb();
    const rows = await idbReq<CustomTool[]>(this.store("readonly").getAll());
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<CustomTool | null> {
    await this.getDb();
    return (await idbReq<CustomTool | undefined>(this.store("readonly").get(id))) ?? null;
  }

  async getByName(name: string): Promise<CustomTool | null> {
    const all = await this.list();
    return all.find((t) => t.name === name) ?? null;
  }

  async save(input: {
    id?: string;
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    kind?: CustomToolKind;
    handlerNote?: string;
  }): Promise<CustomTool> {
    await this.getDb();
    const name = input.name.trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      throw new Error("tool name must match /^[a-z][a-z0-9_]{1,63}$/");
    }
    const existing = input.id ? await this.get(input.id) : await this.getByName(name);
    const now = new Date().toISOString();
    const row: CustomTool = {
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      name,
      description: input.description.trim() || name,
      parameters:
        input.parameters && typeof input.parameters === "object"
          ? input.parameters
          : existing?.parameters ?? { type: "object", properties: {} },
      kind: input.kind === "echo" ? "echo" : "guide",
      handlerNote: input.handlerNote?.trim() || existing?.handlerNote,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // Enforce unique name
    const clash = (await this.list()).find((t) => t.name === name && t.id !== row.id);
    if (clash) throw new Error(`tool name already exists: ${name}`);
    await idbReq(this.store("readwrite").put(row));
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").delete(id));
  }
}

export function runCustomTool(
  tool: CustomTool,
  args: Record<string, unknown>,
): { ok: true; kind: CustomToolKind; name: string; note?: string; args?: Record<string, unknown> } {
  if (tool.kind === "echo") {
    return {
      ok: true,
      kind: "echo",
      name: tool.name,
      note: tool.handlerNote,
      args,
    };
  }
  return {
    ok: true,
    kind: "guide",
    name: tool.name,
    note:
      tool.handlerNote ||
      `Custom guide tool "${tool.name}". Follow the description; use browser/REST tools for side effects.`,
  };
}
