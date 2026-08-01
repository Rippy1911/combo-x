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
  /** 1-based line in the source file where this chunk starts (absent in pre-1.8.1 indexes). */
  startLine?: number;
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
      const startLines = chunkStartLines(file.text, parts);
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
          ...(startLines[i] != null ? { startLine: startLines[i] } : {}),
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

  /** Distinct indexed paths, unbounded — glob filtering happens in memory. */
  async allPaths(): Promise<string[]> {
    await this.getDb();
    const all = await idbReq<RagChunkRow[]>(this.store("chunks", "readonly").getAll());
    return [...new Set(all.map((c) => c.path))].sort();
  }

  /** Every chunk, for a literal scan. */
  async allChunks(): Promise<RagChunkRow[]> {
    await this.getDb();
    return idbReq<RagChunkRow[]>(this.store("chunks", "readonly").getAll());
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
    const paths = await this.allPaths();
    return paths.slice(0, limit);
  }
}

/**
 * Locate each chunk's 1-based start line in the source text. Chunks are
 * sequential substrings of the trimmed, CRLF-normalized text (overlap means a
 * chunk re-starts inside the previous one), so a forward-only indexOf finds
 * each start. Returns undefined for a chunk that cannot be located — grep then
 * falls back to a chunk-relative estimate rather than a wrong file line.
 */
export function chunkStartLines(sourceText: string, parts: string[]): (number | undefined)[] {
  const normalized = sourceText.replace(/\r\n/g, "\n");
  const leadingWs = /^\s*/.exec(normalized)?.[0] ?? "";
  const haystack = normalized.slice(leadingWs.length);
  let line = 1;
  for (let i = 0; i < leadingWs.length; i++) if (leadingWs[i] === "\n") line++;
  const out: (number | undefined)[] = [];
  let searchFrom = 0;
  for (const part of parts) {
    let at = haystack.indexOf(part, searchFrom);
    if (at < 0 && part.length > 60) at = haystack.indexOf(part.slice(0, 60), searchFrom);
    if (at < 0) {
      out.push(undefined);
      continue;
    }
    for (let i = searchFrom; i < at; i++) if (haystack[i] === "\n") line++;
    out.push(line);
    searchFrom = at;
  }
  return out;
}

/**
 * Convert a glob to a RegExp. Supports `**` (any depth), `*` (within a segment),
 * `?`, and `{a,b}` alternation. Anchored to the full path.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  const n = glob.length;
  while (i < n) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more path segments; bare `**` matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close > i) {
        const alts = glob
          .slice(i + 1, close)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        re += `(?:${alts.join("|")})`;
        i = close + 1;
      } else {
        re += "\\{";
        i += 1;
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  before: string[];
  after: string[];
  /** True when the index predates startLine tracking and `line` is chunk-relative. */
  lineIsEstimate?: boolean;
}

/**
 * Literal or regex scan over the indexed corpus with file:line citations.
 * This is the primitive `rag_search` cannot be: exact identifier match.
 */
export function grepChunks(
  chunks: RagChunkRow[],
  opts: {
    pattern: string;
    regex?: boolean;
    caseInsensitive?: boolean;
    glob?: string;
    maxMatches?: number;
    context?: number;
  },
): { matches: GrepMatch[]; scannedFiles: number; truncated: boolean } {
  const maxMatches = Math.max(1, opts.maxMatches ?? 50);
  const context = Math.max(0, Math.min(5, opts.context ?? 2));
  const globRe = opts.glob?.trim() ? globToRegExp(opts.glob.trim()) : null;

  let matcher: RegExp;
  try {
    matcher = opts.regex
      ? new RegExp(opts.pattern, opts.caseInsensitive ? "gi" : "g")
      : new RegExp(
          opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          opts.caseInsensitive ? "gi" : "g",
        );
  } catch {
    return { matches: [], scannedFiles: 0, truncated: false };
  }

  // Chunks overlap, so a source line can appear in two of them. Dedupe on the
  // real file line (startLine recorded at index time): identical text on
  // DIFFERENT lines is still reported, while an overlap duplicate — same line,
  // seen via two chunks — is not. Pre-1.8.1 indexes lack startLine; then the
  // line is chunk-relative and lineIsEstimate flags it.
  const seen = new Set<string>();
  const matches: GrepMatch[] = [];
  let scannedFiles = 0;
  let truncated = false;

  const byPath = new Map<string, RagChunkRow[]>();
  for (const c of chunks) {
    if (globRe && !globRe.test(c.path)) continue;
    const list = byPath.get(c.path);
    if (list) list.push(c);
    else byPath.set(c.path, [c]);
  }
  scannedFiles = byPath.size;

  for (const [path, rows] of byPath) {
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
    for (const row of rows) {
      const lines = row.content.split("\n");
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li]!;
        matcher.lastIndex = 0;
        const m = matcher.exec(lineText);
        if (!m) continue;
        const lineIsEstimate = row.startLine == null;
        const line = lineIsEstimate ? li + 1 : row.startLine! + li;
        const key = `${path}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({
          path,
          line,
          column: m.index + 1,
          text: lineText.trim().slice(0, 240),
          before: context > 0 ? lines.slice(Math.max(0, li - context), li).map((l) => l.trimEnd()) : [],
          after: context > 0 ? lines.slice(li + 1, li + 1 + context).map((l) => l.trimEnd()) : [],
          ...(lineIsEstimate ? { lineIsEstimate: true } : {}),
        });
        if (matches.length >= maxMatches) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  return { matches, scannedFiles, truncated };
}
