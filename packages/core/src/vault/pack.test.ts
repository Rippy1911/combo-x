import { describe, expect, it } from "vitest";
import { createVaultEntry, emptyRegistry, openVaultFromEntry } from "./registry.js";
import {
  buildVaultPack,
  mergeVaultPack,
  packFromCiphertextB64,
  packToCiphertextB64,
} from "./pack.js";

describe("vault pack", () => {
  it("sealed export/import round-trip via pack", async () => {
    const entry = createVaultEntry("A", crypto.randomUUID());
    const vault = openVaultFromEntry(entry);
    await vault.setPassphrase("pass-a");
    await vault.putByLabel("k", "secret-value");
    await vault.lock();

    const pack = await buildVaultPack([entry]);
    expect(pack.vaults).toHaveLength(1);
    const again = packFromCiphertextB64(packToCiphertextB64(pack));
    expect(again.vaults[0]?.name).toBe("A");

    const { state, imported } = await mergeVaultPack(emptyRegistry(), pack);
    expect(imported).toContain(entry.id);
    expect(state.vaults.some((v) => v.id === entry.id)).toBe(true);

    const restored = openVaultFromEntry(state.vaults.find((v) => v.id === entry.id)!);
    expect(await restored.unlock("pass-a")).toBe(true);
    await expect(restored.getByLabel("k")).resolves.toBe("secret-value");
  });
});
