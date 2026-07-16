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

export interface RagFolderRef {
  id: string;
  folderName: string;
}

export interface RagMeta {
  id: "meta";
  folderName: string;
  fileCount: number;
  chunkCount: number;
  indexedAt: string | null;
  lastError: string | null;
  /** Granted folders (multi-root) */
  folders?: RagFolderRef[];
  /** Extra directory names to skip (on top of built-in node_modules/.git/…) */
  excludeDirs?: string[];
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

  async saveHandle(
    handle: FileSystemDirectoryHandle,
    folderName: string,
    id = "root",
  ): Promise<void> {
    await this.getDb();
    await idbReq(
      this.store("handles", "readwrite").put({
        id,
        handle,
        folderName,
        savedAt: new Date().toISOString(),
      }),
    );
    const folders = await this.listFolderRefs();
    const label = folders.map((f) => f.folderName).join(" + ") || folderName;
    await this.setMeta({ folderName: label, folders });
  }

  /** Add another folder root (multi-folder index). */
  async addHandle(handle: FileSystemDirectoryHandle, folderName: string): Promise<string> {
    const id = `f_${crypto.randomUUID().slice(0, 8)}`;
    await this.saveHandle(handle, folderName, id);
    return id;
  }

  async listHandles(): Promise<
    Array<{ id: string; handle: FileSystemDirectoryHandle; folderName: string }>
  > {
    await this.getDb();
    const rows = await idbReq<
      Array<{ id: string; handle: FileSystemDirectoryHandle; folderName: string }>
    >(this.store("handles", "readonly").getAll());
    return (rows ?? []).filter((r) => r?.handle);
  }

  async listFolderRefs(): Promise<RagFolderRef[]> {
    const handles = await this.listHandles();
    return handles.map((h) => ({ id: h.id, folderName: h.folderName }));
  }

  async getHandle(): Promise<{
    handle: FileSystemDirectoryHandle;
    folderName: string;
  } | null> {
    const all = await this.listHandles();
    const root = all.find((h) => h.id === "root") ?? all[0];
    if (!root) return null;
    return { handle: root.handle, folderName: root.folderName };
  }

  async clearHandle(): Promise<void> {
    await this.getDb();
    const all = await this.listHandles();
    const tx = this.db!.transaction("handles", "readwrite");
    for (const h of all) tx.objectStore("handles").delete(h.id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await this.setMeta({ folders: [], folderName: "" });
  }

  async removeHandle(id: string): Promise<void> {
    await this.getDb();
    await idbReq(this.store("handles", "readwrite").delete(id));
    const folders = await this.listFolderRefs();
    await this.setMeta({
      folders,
      folderName: folders.map((f) => f.folderName).join(" + "),
    });
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
