import { describe, expect, it } from "vitest";
import {
  createVaultEntry,
  emptyRegistry,
  loadRegistry,
  saveRegistry,
  upsertVaultEntry,
  VAULT_REGISTRY_KEY,
} from "./registry.js";

describe("VaultRegistry", () => {
  it("round-trips through storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    const entry = createVaultEntry("Work", "id-1");
    const state = upsertVaultEntry(emptyRegistry(), entry);
    saveRegistry(state, storage);
    expect(mem.get(VAULT_REGISTRY_KEY)).toBeTruthy();
    const loaded = loadRegistry(storage);
    expect(loaded.activeId).toBe("id-1");
    expect(loaded.vaults[0]?.name).toBe("Work");
    expect(loaded.vaults[0]?.dbName).toBe("combo_x_vault_id-1");
  });
});
