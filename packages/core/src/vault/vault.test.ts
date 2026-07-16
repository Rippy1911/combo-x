import { beforeEach, describe, expect, it } from "vitest";
import { Vault, VaultLockedError, VaultSealedError } from "./vault.js";

describe("Vault", () => {
  let vault: Vault;

  beforeEach(() => {
    vault = new Vault({ dbName: `test_vault_${crypto.randomUUID()}` });
  });

  it("setPassphrase + unlock round-trip", async () => {
    await vault.setPassphrase("correct horse battery");
    expect(vault.isUnlocked()).toBe(true);
    await vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    await expect(vault.unlock("wrong")).resolves.toBe(false);
    await expect(vault.unlock("correct horse battery")).resolves.toBe(true);
  });

  it("encrypts and decrypts secrets by label", async () => {
    await vault.setPassphrase("secret-pass");
    const id = await vault.put("openrouter_api_key", "sk-or-v1-test");
    expect(id).toBeTruthy();
    await expect(vault.get(id)).resolves.toBe("sk-or-v1-test");
    await expect(vault.getByLabel("openrouter_api_key")).resolves.toBe("sk-or-v1-test");
    await expect(vault.listLabels()).resolves.toContain("openrouter_api_key");
  });

  it("throws when locked", async () => {
    await vault.setPassphrase("x");
    await vault.lock();
    await expect(vault.put("k", "v")).rejects.toBeInstanceOf(VaultLockedError);
  });

  it("throws VaultSealedError when unlocking uninitialized vault", async () => {
    await expect(vault.unlock("anything")).rejects.toBeInstanceOf(VaultSealedError);
  });
});
