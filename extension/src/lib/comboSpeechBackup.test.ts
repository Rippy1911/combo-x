import { describe, expect, it, vi } from "vitest";
import {
  JARVIS_SPEECH_BACKUP_KEY,
  backupJarvisSpeechSecrets,
  restoreJarvisSpeechSecrets,
} from "./comboSpeechBackup.js";

function memStorage(seed: Record<string, unknown> = {}) {
  const data = { ...seed };
  return {
    data,
    get: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
  };
}

describe("comboSpeechBackup", () => {
  it("backs up and restores when vault lost the label", async () => {
    const storage = memStorage();
    const labels = new Map<string, string>();
    labels.set("azure_speech_key", "sekret");
    labels.set("azure_speech_region", "northeurope");
    const vault = {
      isUnlocked: () => true,
      getByLabel: async (l: string) => labels.get(l) ?? null,
      putByLabel: async (l: string, v: string) => {
        labels.set(l, v);
        return "id";
      },
      sealPayload: async (plaintext: string) => ({
        iv_b64: "iv",
        ciphertext_b64: btoa(plaintext),
      }),
      unsealPayload: async (_iv: string, ct: string) => atob(ct),
    };

    await expect(
      backupJarvisSpeechSecrets(vault, "vault-1", { storage }),
    ).resolves.toEqual({ ok: true });
    expect(storage.data[JARVIS_SPEECH_BACKUP_KEY]).toMatchObject({
      vaultId: "vault-1",
    });

    labels.delete("azure_speech_key");
    labels.delete("azure_speech_region");
    await expect(
      restoreJarvisSpeechSecrets(vault, "vault-1", { storage }),
    ).resolves.toEqual({ restored: true });
    expect(labels.get("azure_speech_key")).toBe("sekret");
    expect(labels.get("azure_speech_region")).toBe("northeurope");
  });

  it("skips restore when key already present", async () => {
    const storage = memStorage({
      [JARVIS_SPEECH_BACKUP_KEY]: {
        vaultId: "v",
        iv_b64: "iv",
        ciphertext_b64: btoa(JSON.stringify({ key: "x", region: "northeurope" })),
        at: 1,
      },
    });
    const vault = {
      isUnlocked: () => true,
      getByLabel: async () => "already",
      putByLabel: vi.fn(),
      sealPayload: async () => ({ iv_b64: "", ciphertext_b64: "" }),
      unsealPayload: async () => "",
    };
    await expect(
      restoreJarvisSpeechSecrets(vault, "v", { storage }),
    ).resolves.toEqual({ restored: false, reason: "already present" });
    expect(vault.putByLabel).not.toHaveBeenCalled();
  });
});
