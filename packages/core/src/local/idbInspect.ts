/** Read-only IndexedDB inspector helpers (Views Advanced). Vault plaintext never returned. */

export const INSPECTABLE_DBS: Array<{
  name: string;
  stores: string[];
  /** If true, only return keys + typeof, never values (or redact) */
  redactValues?: boolean;
}> = [
  { name: "combo_x_sessions", stores: ["sessions"] },
  { name: "combo_x_artifacts", stores: ["bookmarks", "reminders", "reports"] },
  { name: "combo_x_attachments", stores: ["files"] },
  { name: "combo_x_rag", stores: ["chunks", "meta", "handles"] },
  { name: "combo_x_memory", stores: ["memories"] },
  { name: "combo_x_views", stores: ["views"] },
  { name: "combo_x_action_log", stores: ["actions"] },
  {
    name: "combo_x_vault",
    stores: ["entries"],
    redactValues: true,
  },
];

export type InspectRow = {
  key: IDBValidKey;
  summary: string;
  value?: unknown;
};

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`open ${name} failed`));
  });
}

export async function listObjectStores(dbName: string): Promise<string[]> {
  const known = INSPECTABLE_DBS.find((d) => d.name === dbName);
  if (known) return known.stores;
  const db = await openDb(dbName);
  try {
    return [...db.objectStoreNames];
  } finally {
    db.close();
  }
}

export async function inspectStore(
  dbName: string,
  storeName: string,
  limit = 50,
): Promise<InspectRow[]> {
  const meta = INSPECTABLE_DBS.find((d) => d.name === dbName);
  const redact = Boolean(meta?.redactValues) || dbName === "combo_x_vault";

  const db = await openDb(dbName);
  try {
    if (![...db.objectStoreNames].includes(storeName)) {
      return [];
    }
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]) ?? []);
      req.onerror = () => reject(req.error);
    });

    const rows: InspectRow[] = [];
    for (let i = 0; i < Math.min(limit, all.length); i++) {
      const key = keys[i] ?? i;
      const value = all[i];
      if (redact) {
        const v = value as { label?: string; ciphertext?: unknown } | null;
        rows.push({
          key,
          summary: v && typeof v === "object" && "label" in v
            ? `label=${String(v.label)} (ciphertext)`
            : `entry (redacted)`,
        });
      } else {
        const json = JSON.stringify(value);
        rows.push({
          key,
          summary: (json ?? "").slice(0, 160),
          value: typeof value === "object" ? value : { value },
        });
      }
    }
    return rows;
  } finally {
    db.close();
  }
}
