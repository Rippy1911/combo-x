/**
 * Sealed chrome.storage.local backup for Combo voice Azure Speech vault labels.
 * Survives Chrome unpacked reloads when IndexedDB is intact; also restores
 * labels if the vault IDB was wiped but storage.local + same passphrase remain
 * (unusual). Encrypted with the unlocked vault KEK — never plaintext.
 */
import {
  AZURE_SPEECH_KEY_LABEL,
  AZURE_SPEECH_REGION_LABEL,
  DEFAULT_AZURE_REGION,
  type Vault,
} from "@combo-x/core";

export const JARVIS_SPEECH_BACKUP_KEY = "combo_x_jarvis_speech_v1";

export type JarvisSpeechBackupRow = {
  vaultId: string;
  iv_b64: string;
  ciphertext_b64: string;
  at: number;
};

type StorageArea = {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

function localStorageArea(): StorageArea | null {
  try {
    const area = chrome?.storage?.local;
    if (!area?.get || !area?.set) return null;
    return {
      get: (keys) =>
        new Promise((resolve, reject) => {
          area.get(keys, (result) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(result as Record<string, unknown>);
          });
        }),
      set: (items) =>
        new Promise((resolve, reject) => {
          area.set(items, () => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
          });
        }),
    };
  } catch {
    return null;
  }
}

export async function backupComboSpeechSecrets(
  vault: Pick<Vault, "getByLabel" | "sealPayload" | "isUnlocked">,
  vaultId: string,
  deps?: { storage?: StorageArea | null },
): Promise<{ ok: boolean; reason?: string }> {
  if (!vaultId) return { ok: false, reason: "no vault id" };
  if (!vault.isUnlocked()) return { ok: false, reason: "locked" };
  const key = (await vault.getByLabel(AZURE_SPEECH_KEY_LABEL))?.trim();
  if (!key) return { ok: false, reason: "no azure_speech_key" };
  const region =
    (await vault.getByLabel(AZURE_SPEECH_REGION_LABEL))?.trim() || DEFAULT_AZURE_REGION;
  const sealed = await vault.sealPayload(JSON.stringify({ key, region }));
  const storage = deps?.storage !== undefined ? deps.storage : localStorageArea();
  if (!storage) return { ok: false, reason: "no chrome.storage.local" };
  const row: JarvisSpeechBackupRow = {
    vaultId,
    iv_b64: sealed.iv_b64,
    ciphertext_b64: sealed.ciphertext_b64,
    at: Date.now(),
  };
  await storage.set({ [JARVIS_SPEECH_BACKUP_KEY]: row });
  return { ok: true };
}

export async function restoreComboSpeechSecrets(
  vault: Pick<Vault, "getByLabel" | "putByLabel" | "unsealPayload" | "isUnlocked">,
  vaultId: string,
  deps?: { storage?: StorageArea | null },
): Promise<{ restored: boolean; reason?: string }> {
  if (!vaultId) return { restored: false, reason: "no vault id" };
  if (!vault.isUnlocked()) return { restored: false, reason: "locked" };
  const existing = (await vault.getByLabel(AZURE_SPEECH_KEY_LABEL))?.trim();
  if (existing) return { restored: false, reason: "already present" };
  const storage = deps?.storage !== undefined ? deps.storage : localStorageArea();
  if (!storage) return { restored: false, reason: "no chrome.storage.local" };
  const got = await storage.get(JARVIS_SPEECH_BACKUP_KEY);
  const row = got[JARVIS_SPEECH_BACKUP_KEY] as JarvisSpeechBackupRow | undefined;
  if (!row?.iv_b64 || !row?.ciphertext_b64) {
    return { restored: false, reason: "no backup" };
  }
  if (row.vaultId && row.vaultId !== vaultId) {
    return { restored: false, reason: "vault id mismatch" };
  }
  try {
    const json = await vault.unsealPayload(row.iv_b64, row.ciphertext_b64);
    const data = JSON.parse(json) as { key?: unknown; region?: unknown };
    if (typeof data.key !== "string" || !data.key.trim()) {
      return { restored: false, reason: "bad payload" };
    }
    await vault.putByLabel(AZURE_SPEECH_KEY_LABEL, data.key.trim());
    const region =
      typeof data.region === "string" && data.region.trim()
        ? data.region.trim()
        : DEFAULT_AZURE_REGION;
    await vault.putByLabel(AZURE_SPEECH_REGION_LABEL, region);
    return { restored: true };
  } catch {
    return { restored: false, reason: "unseal failed (passphrase changed?)" };
  }
}

/** @deprecated */
export const backupJarvisSpeechSecrets = backupComboSpeechSecrets;
/** @deprecated */
export const restoreJarvisSpeechSecrets = restoreComboSpeechSecrets;
