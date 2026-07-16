import { chunkText } from "./chunk.js";
import { hybridScore, mockVector } from "./embed.js";

export interface RagChunkRow {
  id: string;
  path: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  bytes: number;
  indexedAt: string;
}

export interface RagMeta {
  id: "meta";
  folderName: string;
  fileCount: number;
  chunkCount: number;
  indexedAt: string | null;
  lastError: string | null;
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chunks")) {
        const store = db.createObjectStore("chunks", { keyPath: "id" });
        store.createIndex("by_path", "path", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("rag db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export interface IndexedFile {
  path: string;
  text: string;
}

export class RagStore {
  private db: IDBDatabase | null = null;

  constructor(private readonly dbName = "combo_x_rag") {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }

  private store(name: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction(name, mode).objectStore(name);
  }

  async saveHandle(handle: FileSystemDirectoryHandle, folderName: string): Promise<void> {
    await this.getDb();
    await idbReq(
      this.store("handles", "readwrite").put({
        id: "root",
        handle,
        folderName,
        savedAt: new Date().toISOString(),
      }),
    );
    const meta = (await this.getMeta()) ?? {
      id: "meta" as const,
      folderName,
      fileCount: 0,
      chunkCount: 0,
      indexedAt: null,
      lastError: null,
    };
    meta.folderName = folderName;
    await idbReq(this.store("meta", "readwrite").put(meta));
  }

  async getHandle(): Promise<{
    handle: FileSystemDirectoryHandle;
    folderName: string;
  } | null> {
    await this.getDb();
    const row = await idbReq<{
      handle: FileSystemDirectoryHandle;
      folderName: string;
    } | undefined>(this.store("handles", "readonly").get("root"));
    if (!row?.handle) return null;
    return { handle: row.handle, folderName: row.folderName };
  }

  async clearHandle(): Promise<void> {
    await this.getDb();
    await idbReq(this.store("handles", "readwrite").delete("root"));
  }

  async getMeta(): Promise<RagMeta | null> {
    await this.getDb();
    return (await idbReq<RagMeta | undefined>(this.store("meta", "readonly").get("meta"))) ?? null;
  }

  async setMeta(patch: Partial<RagMeta>): Promise<RagMeta> {
    await this.getDb();
    const prev = (await this.getMeta()) ?? {
      id: "meta" as const,
      folderName: "",
      fileCount: 0,
      chunkCount: 0,
      indexedAt: null,
      lastError: null,
    };
    const next = { ...prev, ...patch, id: "meta" as const };
    await idbReq(this.store("meta", "readwrite").put(next));
    return next;
  }

  async clearChunks(): Promise<void> {
    await this.getDb();
    await idbReq(this.store("chunks", "readwrite").clear());
  }

  /** Replace index from in-memory files (used by indexer + tests). */
  async rebuildFromFiles(files: IndexedFile[], folderName: string): Promise<RagMeta> {
    await this.clearChunks();
    await this.getDb();
    const now = new Date().toISOString();
    let chunkCount = 0;
    const tx = this.db!.transaction("chunks", "readwrite");
    const store = tx.objectStore("chunks");
    for (const file of files) {
      const parts = chunkText(file.text);
      for (let i = 0; i < parts.length; i++) {
        const content = parts[i]!;
        const row: RagChunkRow = {
          id: `${file.path}#${i}`,
          path: file.path,
          chunkIndex: i,
          content,
          embedding: mockVector(content),
          bytes: content.length,
          indexedAt: now,
        };
        store.put(row);
        chunkCount += 1;
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("chunk tx failed"));
    });
    return this.setMeta({
      folderName,
      fileCount: files.length,
      chunkCount,
      indexedAt: now,
      lastError: null,
    });
  }

  async search(query: string, limit = 8): Promise<Array<RagChunkRow & { score: number }>> {
    await this.getDb();
    const all = await idbReq<RagChunkRow[]>(this.store("chunks", "readonly").getAll());
    return all
      .map((c) => ({ ...c, score: hybridScore(query, c.content, c.embedding) }))
      .filter((c) => c.score > 0.08)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async readPath(path: string, maxChars = 12_000): Promise<{ path: string; content: string; truncated: boolean } | null> {
    await this.getDb();
    const idx = this.store("chunks", "readonly").index("by_path");
    const rows = await idbReq<RagChunkRow[]>(idx.getAll(path));
    if (!rows.length) return null;
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
    // Reconstruct approximate file by joining chunks (overlap may duplicate — good enough for agent)
    let content = rows.map((r) => r.content).join("\n\n");
    const truncated = content.length > maxChars;
    if (truncated) content = content.slice(0, maxChars);
    return { path, content, truncated };
  }

  async listPaths(limit = 200): Promise<string[]> {
    await this.getDb();
    const all = await idbReq<RagChunkRow[]>(this.store("chunks", "readonly").getAll());
    return [...new Set(all.map((c) => c.path))].sort().slice(0, limit);
  }
}
