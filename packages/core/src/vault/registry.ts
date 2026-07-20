/**
 * Multi-vault registry — localStorage index of named Vault IDBs.
 */

import { Vault } from "./vault.js";

export const VAULT_REGISTRY_KEY = "combo_x_vault_registry";
export const LEGACY_VAULT_DB = "combo_x_vault";

export type VaultRegistryEntry = {
  id: string;
  name: string;
  dbName: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultRegistryState = {
  activeId: string | null;
  vaults: VaultRegistryEntry[];
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export function emptyRegistry(): VaultRegistryState {
  return { activeId: null, vaults: [] };
}

export function loadRegistry(storage: StorageLike | null = defaultStorage()): VaultRegistryState {
  if (!storage) return emptyRegistry();
  try {
    const raw = storage.getItem(VAULT_REGISTRY_KEY);
    if (!raw) return emptyRegistry();
    const parsed = JSON.parse(raw) as VaultRegistryState;
    if (!parsed || !Array.isArray(parsed.vaults)) return emptyRegistry();
    return {
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      vaults: parsed.vaults.filter(
        (v) => v && typeof v.id === "string" && typeof v.dbName === "string",
      ),
    };
  } catch {
    return emptyRegistry();
  }
}

export function saveRegistry(
  state: VaultRegistryState,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  storage.setItem(VAULT_REGISTRY_KEY, JSON.stringify(state));
}

export function vaultDbNameForId(id: string): string {
  return `combo_x_vault_${id}`;
}

export function createVaultEntry(name: string, id: string = crypto.randomUUID()): VaultRegistryEntry {
  const now = new Date().toISOString();
  return {
    id,
    name: name.trim() || "Vault",
    dbName: vaultDbNameForId(id),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * If registry empty but legacy `combo_x_vault` is initialized, adopt it as "Default".
 */
export async function ensureRegistryMigrated(
  storage: StorageLike | null = defaultStorage(),
): Promise<VaultRegistryState> {
  let state = loadRegistry(storage);
  if (state.vaults.length > 0) {
    if (!state.activeId || !state.vaults.some((v) => v.id === state.activeId)) {
      state = { ...state, activeId: state.vaults[0]!.id };
      saveRegistry(state, storage);
    }
    return state;
  }
  const legacy = new Vault({ dbName: LEGACY_VAULT_DB });
  if (await legacy.isInitialized()) {
    const now = new Date().toISOString();
    const entry: VaultRegistryEntry = {
      id: "default",
      name: "Default",
      dbName: LEGACY_VAULT_DB,
      createdAt: now,
      updatedAt: now,
    };
    state = { activeId: entry.id, vaults: [entry] };
    saveRegistry(state, storage);
    return state;
  }
  return state;
}

export function openVaultFromEntry(entry: VaultRegistryEntry): Vault {
  return new Vault({ dbName: entry.dbName });
}

export function getActiveEntry(state: VaultRegistryState): VaultRegistryEntry | null {
  if (!state.activeId) return null;
  return state.vaults.find((v) => v.id === state.activeId) ?? null;
}

export function upsertVaultEntry(
  state: VaultRegistryState,
  entry: VaultRegistryEntry,
  opts?: { makeActive?: boolean },
): VaultRegistryState {
  const others = state.vaults.filter((v) => v.id !== entry.id);
  const next: VaultRegistryState = {
    activeId: opts?.makeActive === false ? state.activeId : entry.id,
    vaults: [...others, { ...entry, updatedAt: new Date().toISOString() }].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
  if (!next.activeId) next.activeId = entry.id;
  return next;
}

export function renameVaultEntry(
  state: VaultRegistryState,
  id: string,
  name: string,
): VaultRegistryState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    vaults: state.vaults.map((v) =>
      v.id === id ? { ...v, name: trimmed, updatedAt: new Date().toISOString() } : v,
    ),
  };
}

export function setActiveVaultId(state: VaultRegistryState, id: string): VaultRegistryState {
  if (!state.vaults.some((v) => v.id === id)) return state;
  return { ...state, activeId: id };
}
