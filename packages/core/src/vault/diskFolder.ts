/**
 * File System Access backup folder for sealed vault packs.
 * Not a free filesystem path — browser-granted directory handle only.
 */

import { isVaultPack, type VaultPack } from "./pack.js";

const FS_DB = "combo_x_fs_handles";
const FS_STORE = "handles";
const DIR_KEY = "vault_backup_dir";
export const VAULT_PACK_FILENAME = "vault-pack.json";

function openFsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FS_STORE)) {
        db.createObjectStore(FS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("fs handles db failed"));
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE, "readwrite");
    tx.objectStore(FS_STORE).put(handle, DIR_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("save handle failed"));
  });
  db.close();
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openFsDb();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(FS_STORE, "readonly");
    const req = tx.objectStore(FS_STORE).get(DIR_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error ?? new Error("load handle failed"));
  });
  db.close();
  return handle;
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await openFsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE, "readwrite");
    tx.objectStore(FS_STORE).delete(DIR_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("clear handle failed"));
  });
  db.close();
}

type DirPicker = (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;

export function canPickDirectory(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: DirPicker }).showDirectoryPicker === "function";
}

export async function pickVaultBackupDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const pick = (globalThis as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  if (!pick) return null;
  const handle = await pick({ mode: "readwrite" });
  await saveDirectoryHandle(handle);
  return handle;
}

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  const opts = { mode };
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  const q = await h.queryPermission?.(opts);
  if (q === "granted") return true;
  const r = await h.requestPermission?.(opts);
  return r === "granted";
}

export async function writeVaultPackToDirectory(
  handle: FileSystemDirectoryHandle,
  pack: VaultPack,
  filename = VAULT_PACK_FILENAME,
): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  try {
    if (!(await ensurePermission(handle, "readwrite"))) {
      return { ok: false, error: "folder permission denied" };
    }
    const file = await handle.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(pack, null, 2));
    await writable.close();
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readVaultPackFromDirectory(
  handle: FileSystemDirectoryHandle,
  filename = VAULT_PACK_FILENAME,
): Promise<{ ok: true; pack: VaultPack } | { ok: false; error: string }> {
  try {
    if (!(await ensurePermission(handle, "read"))) {
      return { ok: false, error: "folder permission denied" };
    }
    const file = await handle.getFileHandle(filename);
    const blob = await file.getFile();
    const text = await blob.text();
    const parsed = JSON.parse(text) as unknown;
    if (!isVaultPack(parsed)) return { ok: false, error: "file is not a vault pack" };
    return { ok: true, pack: parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
