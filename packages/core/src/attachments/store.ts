import type { AttachmentKind } from "./parse.js";

export interface AttachmentRecord {
  id: string;
  sessionId: string;
  name: string;
  mime: string;
  kind: AttachmentKind;
  size: number;
  text: string;
  dataUrl?: string;
  meta: Record<string, string | number | boolean>;
  truncated: boolean;
  error?: string;
  createdAt: number;
}

const DB_NAME = "combo_x_attachments";
const STORE = "files";
const DB_VERSION = 1;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("sessionId", "sessionId", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("idb tx aborted"));
  });
}

export class AttachmentStore {
  constructor(private readonly dbName = DB_NAME) {}

  async put(record: AttachmentRecord): Promise<AttachmentRecord> {
    const db = await openDb(this.dbName);
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      await txDone(tx);
      return record;
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<AttachmentRecord | null> {
    const db = await openDb(this.dbName);
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      const row = await new Promise<AttachmentRecord | undefined>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as AttachmentRecord | undefined);
        req.onerror = () => reject(req.error);
      });
      await txDone(tx);
      return row ?? null;
    } finally {
      db.close();
    }
  }

  async list(sessionId?: string): Promise<AttachmentRecord[]> {
    const db = await openDb(this.dbName);
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = sessionId
        ? store.index("sessionId").getAll(sessionId)
        : store.getAll();
      const rows = await new Promise<AttachmentRecord[]>((resolve, reject) => {
        req.onsuccess = () => resolve((req.result as AttachmentRecord[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      await txDone(tx);
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    } finally {
      db.close();
    }
  }

  async read(
    idOrName: string,
    maxChars = 200_000,
  ): Promise<{ id: string; name: string; kind: AttachmentKind; content: string; truncated: boolean } | null> {
    const all = await this.list();
    const row =
      all.find((r) => r.id === idOrName) ??
      all.find((r) => r.name === idOrName || r.name.endsWith(`/${idOrName}`));
    if (!row) return null;
    if (row.kind === "image") {
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        content: row.dataUrl
          ? `[image attached: ${row.name}; vision data sent with user turn when uploaded]`
          : "[image with no dataUrl]",
        truncated: false,
      };
    }
    const content = row.text.slice(0, maxChars);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      content,
      truncated: row.text.length > maxChars || row.truncated,
    };
  }

  async remove(id: string): Promise<void> {
    const db = await openDb(this.dbName);
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      await txDone(tx);
    } finally {
      db.close();
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    const rows = await this.list(sessionId);
    const db = await openDb(this.dbName);
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const r of rows) store.delete(r.id);
      await txDone(tx);
    } finally {
      db.close();
    }
  }

  /** Sum of recorded `size` fields (bytes). */
  async totalBytes(sessionId?: string): Promise<number> {
    const rows = await this.list(sessionId);
    return rows.reduce((n, r) => n + (r.size || 0), 0);
  }

  /** Screenshots from ux_critique / screenshot_* (vision meta or name prefix). */
  async listScreenshots(sessionId?: string): Promise<AttachmentRecord[]> {
    const rows = await this.list(sessionId);
    return rows.filter(
      (r) =>
        r.kind === "image" &&
        (r.meta?.vision === true ||
          r.meta?.source === "ux-viewport" ||
          String(r.meta?.source ?? "").startsWith("ux-") ||
          r.name.startsWith("screenshot-")),
    );
  }

  async clearScreenshots(): Promise<number> {
    const rows = await this.listScreenshots();
    for (const r of rows) await this.remove(r.id);
    return rows.length;
  }
}
