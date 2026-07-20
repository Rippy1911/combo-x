/** Local prefs for Combo Link + chat sync (device-local, not vault). */

export const LINK_ENABLED_KEY = "combo_x_link_enabled";
export const SYNC_CHATS_KEY = "combo_x_sync_chats";
export const SESSION_SYNC_VERSIONS_KEY = "combo_x_session_sync_versions";

export type LinkLocalConfig = {
  linkEnabled: boolean;
  /** Encrypted sessions_manifest / session:{id} sync when cloud connected. */
  syncChats: boolean;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function storage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export function loadLinkConfig(store: StorageLike | null = storage()): LinkLocalConfig {
  const s = store;
  const linkEnabled = s?.getItem(LINK_ENABLED_KEY) === "1";
  const syncRaw = s?.getItem(SYNC_CHATS_KEY);
  // Default ON when Link is enabled; otherwise respect explicit 0/1 or default false
  const syncChats =
    syncRaw === "1" || (syncRaw === null && linkEnabled) || (linkEnabled && syncRaw !== "0");
  return { linkEnabled, syncChats };
}

export function saveLinkConfig(
  cfg: Partial<LinkLocalConfig>,
  store: StorageLike | null = storage(),
): LinkLocalConfig {
  const prev = loadLinkConfig(store);
  const linkEnabled = cfg.linkEnabled ?? prev.linkEnabled;
  // Turning Link on defaults Sync chats ON unless explicitly set
  let syncChats = cfg.syncChats ?? prev.syncChats;
  if (cfg.linkEnabled === true && cfg.syncChats === undefined && !prev.linkEnabled) {
    syncChats = true;
  }
  const next: LinkLocalConfig = { linkEnabled, syncChats };
  if (!store) return next;
  store.setItem(LINK_ENABLED_KEY, next.linkEnabled ? "1" : "0");
  store.setItem(SYNC_CHATS_KEY, next.syncChats ? "1" : "0");
  return next;
}

export function loadSessionSyncVersions(
  store: StorageLike | null = storage(),
): Record<string, number> {
  if (!store) return {};
  try {
    const raw = store.getItem(SESSION_SYNC_VERSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSessionSyncVersions(
  versions: Record<string, number>,
  store: StorageLike | null = storage(),
): void {
  store?.setItem(SESSION_SYNC_VERSIONS_KEY, JSON.stringify(versions));
}
