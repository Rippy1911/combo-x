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

const SENSITIVE_KEY =
  /password|secret|token|api[_-]?key|authorization|passwd|credential/i;

/** Deep-strip password-like keys from objects (profiles, nested results). */
export function redactSensitiveDeep(value: unknown, depth = 0): unknown {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitiveDeep(v, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactSensitiveDeep(v, depth + 1);
  }
  return out;
}

/** Strip password-like keys from row objects / profile summaries (UC-Privacy). */
export function redactSensitiveFields<T extends Record<string, unknown>>(
  row: T,
): T {
  return redactSensitiveDeep(row) as T;
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

/** Ensure a named view exists with the given column headers. */
export async function ensureView(
  store: ViewStore,
  input: { name: string; columns: string[]; keyColumns?: string[] },
): Promise<SavedView> {
  const existing = await store.get(input.name);
  const note =
    input.keyColumns && input.keyColumns.length > 0
      ? `keyColumns:${input.keyColumns.join(",")}`
      : undefined;
  if (existing) {
    return store.save({
      id: existing.id,
      name: input.name,
      source: existing.source ?? "manual",
      columns: input.columns,
      rows: existing.rows?.length
        ? [input.columns, ...existing.rows.slice(1)]
        : [input.columns],
      note: note ?? existing.note,
    });
  }
  return store.save({
    name: input.name,
    source: "manual",
    columns: input.columns,
    rows: [input.columns],
    note,
  });
}

function keyIndices(columns: string[], keyColumns: string[]): number[] {
  const lower = columns.map((c) => c.toLowerCase());
  return keyColumns.map((k) => lower.indexOf(k.toLowerCase())).filter((i) => i >= 0);
}

function rowKey(row: string[], indices: number[]): string {
  return indices.map((i) => row[i] ?? "").join("\u0000");
}

/** Merge rows into a view by key column header names (upsert on match). */
export async function upsertRows(
  store: ViewStore,
  viewId: string,
  rows: string[][],
  keyColumns: string[],
): Promise<SavedView> {
  const view = await store.get(viewId);
  if (!view) throw new Error(`view not found: ${viewId}`);
  const header = view.rows?.[0] ?? view.columns ?? [];
  if (header.length === 0) throw new Error("view has no columns");
  const indices = keyIndices(header, keyColumns);
  if (indices.length === 0) throw new Error(`key columns not found in header: ${keyColumns.join(", ")}`);

  const existing = view.rows ?? [header];
  const dataRows = existing.slice(1);
  const byKey = new Map<string, string[]>();
  for (const row of dataRows) {
    byKey.set(rowKey(row, indices), row);
  }
  for (const row of rows) {
    if (row.length === 0) continue;
    const padded = [...row];
    while (padded.length < header.length) padded.push("");
    byKey.set(rowKey(padded, indices), padded.slice(0, header.length));
  }
  const merged = [header, ...Array.from(byKey.values())];
  return store.save({
    id: view.id,
    name: view.name,
    source: view.source,
    columns: header,
    rows: merged,
    filter: view.filter,
    chart: view.chart,
    note: view.note,
  });
}
