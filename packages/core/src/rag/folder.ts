import type { IndexedFile, RagMeta, RagStore } from "./store.js";

// The installed TS lib.dom.d.ts ships FileSystemDirectoryHandle but not the
// File System Access entry point / permission mode. Declare just those two.
declare global {
  type FileSystemPermissionMode = "read" | "readwrite";
  function showDirectoryPicker(options?: {
    id?: string;
    mode?: FileSystemPermissionMode;
    startIn?: unknown;
  }): Promise<FileSystemDirectoryHandle>;
}

/** Built-in skips — always applied. */
export const DEFAULT_SKIP_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "dist-types",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".cursor",
] as const;

const TEXT_EXT = new Set([
  "md",
  "mdc",
  "txt",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "css",
  "scss",
  "html",
  "htm",
  "yml",
  "yaml",
  "toml",
  "sql",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "sh",
  "bash",
  "zsh",
  "env",
  "example",
  "gitignore",
  "dockerignore",
  "editorconfig",
  "svg",
]);

const MAX_FILE_BYTES = 220_000;
const MAX_FILES = 2_500;

export function shouldIndexFile(path: string, extraSkip: string[] = []): boolean {
  const skip = new Set<string>([...DEFAULT_SKIP_DIRS, ...extraSkip.map((s) => s.trim()).filter(Boolean)]);
  const base = path.split("/").pop() ?? path;
  const parts = path.split("/");
  for (const p of parts) {
    if (skip.has(p)) return false;
  }
  if (base === "AGENTS.md" || base === "README" || base === "LICENSE") return true;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return base === "Makefile" || base === "Dockerfile";
  const ext = base.slice(dot + 1).toLowerCase();
  return TEXT_EXT.has(ext);
}

export async function ensureDirPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = "read",
): Promise<boolean> {
  const opts = { mode } as const;
  // @ts-expect-error — FileSystemHandle permission API
  const q = await handle.queryPermission?.(opts);
  if (q === "granted") return true;
  // @ts-expect-error — requestPermission
  const r = await handle.requestPermission?.(opts);
  return r === "granted";
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (typeof showDirectoryPicker !== "function") {
    throw new Error("File System Access API unavailable in this browser");
  }
  return showDirectoryPicker({
    id: "combo-x-rag",
    mode: "read",
    startIn: "documents",
  });
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: IndexedFile[],
  errors: string[],
  extraSkip: string[],
): Promise<void> {
  const skip = new Set<string>([...DEFAULT_SKIP_DIRS, ...extraSkip]);
  if (out.length >= MAX_FILES) return;
  // @ts-expect-error — async iterator on directory handle
  for await (const [name, handle] of dir.entries()) {
    if (out.length >= MAX_FILES) return;
    if (handle.kind === "directory") {
      if (skip.has(name)) continue;
      await walk(
        handle as FileSystemDirectoryHandle,
        prefix ? `${prefix}/${name}` : name,
        out,
        errors,
        extraSkip,
      );
      continue;
    }
    const path = prefix ? `${prefix}/${name}` : name;
    if (!shouldIndexFile(path, extraSkip)) continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      if (file.size > MAX_FILE_BYTES) {
        errors.push(`skip large: ${path} (${file.size}b)`);
        continue;
      }
      const text = await file.text();
      if (!text.trim()) continue;
      out.push({ path, text });
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export interface IndexProgress {
  phase: "walk" | "index" | "done" | "error";
  files?: number;
  chunks?: number;
  message?: string;
}

export interface IndexOptions {
  excludeDirs?: string[];
  /** Path prefix for this root (folder name) when multi-folder */
  pathPrefix?: string;
}

/** Full reindex from a granted directory handle. */
export async function indexDirectory(
  store: RagStore,
  handle: FileSystemDirectoryHandle,
  onProgress?: (p: IndexProgress) => void,
  opts: IndexOptions = {},
): Promise<RagMeta> {
  const ok = await ensureDirPermission(handle, "read");
  if (!ok) throw new Error("Folder permission denied — re-grant from Settings");

  const extra = opts.excludeDirs ?? (await store.getMeta())?.excludeDirs ?? [];
  onProgress?.({ phase: "walk", message: "Scanning folder…" });
  const files: IndexedFile[] = [];
  const errors: string[] = [];
  const prefix = opts.pathPrefix ?? "";
  await walk(handle, prefix, files, errors, extra);
  onProgress?.({ phase: "index", files: files.length, message: `Indexing ${files.length} files…` });

  const meta = await store.rebuildFromFiles(files, handle.name);
  if (errors.length) {
    await store.setMeta({
      lastError: errors.slice(0, 5).join("; ") + (errors.length > 5 ? ` (+${errors.length - 5})` : ""),
    });
  }
  onProgress?.({
    phase: "done",
    files: meta.fileCount,
    chunks: meta.chunkCount,
    message: `Indexed ${meta.fileCount} files / ${meta.chunkCount} chunks`,
  });
  return meta;
}

/** Walk every granted folder and rebuild one index. */
export async function reindexAll(
  store: RagStore,
  onProgress?: (p: IndexProgress) => void,
  excludeDirs?: string[],
): Promise<RagMeta> {
  const handles = await store.listHandles();
  if (!handles.length) throw new Error("No folder granted yet — use Add folder first");
  if (excludeDirs) await store.setMeta({ excludeDirs });
  const extra = excludeDirs ?? (await store.getMeta())?.excludeDirs ?? [];

  const files: IndexedFile[] = [];
  const errors: string[] = [];
  onProgress?.({ phase: "walk", message: `Scanning ${handles.length} folder(s)…` });
  for (const h of handles) {
    const ok = await ensureDirPermission(h.handle, "read");
    if (!ok) {
      errors.push(`permission denied: ${h.folderName}`);
      continue;
    }
    await walk(h.handle, h.folderName, files, errors, extra);
  }
  onProgress?.({ phase: "index", files: files.length, message: `Indexing ${files.length} files…` });
  const label = handles.map((h) => h.folderName).join(" + ");
  const meta = await store.rebuildFromFiles(files, label);
  await store.setMeta({
    folders: handles.map((h) => ({ id: h.id, folderName: h.folderName })),
    excludeDirs: extra,
    lastError: errors.length
      ? errors.slice(0, 5).join("; ") + (errors.length > 5 ? ` (+${errors.length - 5})` : "")
      : null,
  });
  onProgress?.({
    phase: "done",
    files: meta.fileCount,
    chunks: meta.chunkCount,
    message: `Indexed ${meta.fileCount} files / ${meta.chunkCount} chunks from ${handles.length} folder(s)`,
  });
  return (await store.getMeta())!;
}

/** Grant + save + index. append=true adds another root without wiping. */
export async function grantAndIndex(
  store: RagStore,
  onProgress?: (p: IndexProgress) => void,
  opts?: { append?: boolean; excludeDirs?: string[] },
): Promise<RagMeta> {
  const handle = await pickDirectory();
  if (opts?.excludeDirs) await store.setMeta({ excludeDirs: opts.excludeDirs });
  if (opts?.append) {
    await store.addHandle(handle, handle.name);
  } else {
    await store.clearHandle();
    await store.saveHandle(handle, handle.name, "root");
  }
  return reindexAll(store, onProgress, opts?.excludeDirs);
}

/** Reindex using previously saved handle(s). */
export async function reindexSaved(
  store: RagStore,
  onProgress?: (p: IndexProgress) => void,
): Promise<RagMeta> {
  return reindexAll(store, onProgress);
}
