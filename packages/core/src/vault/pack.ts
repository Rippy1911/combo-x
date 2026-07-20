/**
 * Multi-vault pack — ciphertext-only blob for cloud sync + disk backup.
 */

import { b64ToUtf8, utf8ToB64 } from "./bytes.js";
import {
  createVaultEntry,
  openVaultFromEntry,
  type VaultRegistryEntry,
  type VaultRegistryState,
  upsertVaultEntry,
} from "./registry.js";
import {
  SEALED_VAULT_FORMAT,
  type SealedVaultBlob,
  Vault,
} from "./vault.js";

export const VAULT_PACK_FORMAT = "combo-x-vault-pack-v1" as const;

export type VaultPackEntry = {
  id: string;
  name: string;
  sealed: SealedVaultBlob;
};

export type VaultPack = {
  format: typeof VAULT_PACK_FORMAT;
  vaults: VaultPackEntry[];
  exportedAt?: string;
};

export function isVaultPack(value: unknown): value is VaultPack {
  if (!value || typeof value !== "object") return false;
  const v = value as VaultPack;
  return v.format === VAULT_PACK_FORMAT && Array.isArray(v.vaults);
}

export async function buildVaultPack(
  entries: VaultRegistryEntry[],
): Promise<VaultPack> {
  const vaults: VaultPackEntry[] = [];
  for (const entry of entries) {
    const vault = openVaultFromEntry(entry);
    const sealed = await vault.exportSealed();
    if (!sealed) continue;
    vaults.push({ id: entry.id, name: entry.name, sealed });
  }
  return {
    format: VAULT_PACK_FORMAT,
    vaults,
    exportedAt: new Date().toISOString(),
  };
}

export function packToCiphertextB64(pack: VaultPack): string {
  return utf8ToB64(JSON.stringify(pack));
}

export function packFromCiphertextB64(b64: string): VaultPack {
  const parsed = JSON.parse(b64ToUtf8(b64)) as unknown;
  if (!isVaultPack(parsed)) throw new Error("invalid vault pack ciphertext");
  for (const v of parsed.vaults) {
    if (!v?.sealed || v.sealed.format !== SEALED_VAULT_FORMAT) {
      throw new Error(`invalid sealed vault in pack: ${v?.id ?? "?"}`);
    }
  }
  return parsed;
}

/**
 * Merge pack into registry + IDB. Does not unlock vaults.
 * Returns updated registry state (caller should save).
 */
export async function mergeVaultPack(
  state: VaultRegistryState,
  pack: VaultPack,
): Promise<{ state: VaultRegistryState; imported: string[]; skipped: string[] }> {
  if (!isVaultPack(pack)) throw new Error("invalid vault pack");
  let next = state;
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const item of pack.vaults) {
    if (!item.id || !item.sealed) {
      skipped.push(item.id || "?");
      continue;
    }
    const existing = next.vaults.find((v) => v.id === item.id);
    const entry =
      existing ??
      createVaultEntry(item.name || "Vault", item.id);
    const named: VaultRegistryEntry = {
      ...entry,
      name: item.name?.trim() || entry.name,
      updatedAt: new Date().toISOString(),
    };
    // Keep legacy dbName if already registered under that id.
    const vault = new Vault({ dbName: named.dbName });
    await vault.importSealed(item.sealed);
    next = upsertVaultEntry(next, named, { makeActive: false });
    imported.push(named.id);
  }
  if (!next.activeId && next.vaults[0]) {
    next = { ...next, activeId: next.vaults[0].id };
  }
  return { state: next, imported, skipped };
}
