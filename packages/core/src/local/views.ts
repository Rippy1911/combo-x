/**
 * Named Views — durable tables the agent or user saves for the Views tab.
 * Snapshots are plaintext IDB (same class as sessions/artifacts) — never store vault secrets.
 */

export type ViewSource = "snapshot" | `collection:${string}` | "manual";

export type ViewChartSpec = {
  type: "bar" | "line";
  /** Column index (0-based) for Y values; X = row index or first column */
  valueColumn: number;
  labelColumn?: number;
};

export interface SavedView {
  id: string;
  name: string;
  source: ViewSource;
  columns?: string[];
  filter?: string;
  /** Header row + data rows */
  rows?: string[][];
  chart?: ViewChartSpec;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

const DB_NAME = "combo_x_views";
const STORE = "views";
const DB_VERSION = 1;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("name", "name", { unique: false });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("views db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

/** Strip password-like keys from row objects / profile summaries (UC-Privacy). */
export function redactSensitiveFields<T extends Record<string, unknown>>(
  row: T,
): T {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("password") ||
      lower.includes("secret") ||
      lower.includes("token") ||
      lower === "api_key" ||
      lower === "apikey"
    ) {
      (out as Record<string, unknown>)[key] = "[redacted]";
    }
  }
  return out;
}

export function siteProfileLabelName(label: string): string | null {
  if (!label.startsWith("site_profile:")) return null;
  return label.slice("site_profile:".length) || null;
}

export class ViewStore {
  constructor(private readonly dbName = DB_NAME) {}

  async save(
    input: Omit<SavedView, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<SavedView> {
    const now = new Date().toISOString();
    const existing = input.id ? await this.get(input.id) : null;
    const byName =
      !existing && input.name
        ? (await this.list()).find(
            (v) => v.name.toLowerCase() === input.name.toLowerCase(),
          )
        : null;
    const id = existing?.id ?? byName?.id ?? input.id ?? crypto.randomUUID();
    const row: SavedView = {
      id,
      name: input.name.trim() || "Untitled view",
      source: input.source,
      columns: input.columns,
      filter: input.filter,
      rows: input.rows,
      chart: input.chart,
      note: input.note,
      createdAt: existing?.createdAt ?? byName?.createdAt ?? now,
      updatedAt: now,
    };
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(row));
      return row;
    } finally {
      db.close();
    }
  }

  async get(idOrName: string): Promise<SavedView | null> {
    const db = await openDb(this.dbName);
    try {
      const byId = await idbReq<SavedView | undefined>(
        db.transaction(STORE, "readonly").objectStore(STORE).get(idOrName),
      );
      if (byId) return byId;
      const all = await idbReq<SavedView[]>(
        db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
      );
      return (
        all.find((v) => v.name.toLowerCase() === idOrName.toLowerCase()) ?? null
      );
    } finally {
      db.close();
    }
  }

  async list(): Promise<SavedView[]> {
    const db = await openDb(this.dbName);
    try {
      const all = await idbReq<SavedView[]>(
        db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
      );
      return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } finally {
      db.close();
    }
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).delete(existing.id));
      return true;
    } finally {
      db.close();
    }
  }
}
