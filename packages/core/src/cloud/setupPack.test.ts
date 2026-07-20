import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { Vault } from "../vault/vault.js";
import { nsFoodRestTemplate } from "../connectors/templates.js";
import {
  sanitizeConnectorForSync,
  sealSetupPack,
  setupPackFromB64,
  setupPackToB64,
  unsealSetupPack,
} from "./setupPack.js";

describe("setupPack", () => {
  let vault: Vault;

  beforeEach(async () => {
    vault = new Vault({ dbName: `setup-pack-${crypto.randomUUID()}` });
    await vault.setPassphrase("test-passphrase-xyz");
  });

  it("sanitizes bearer-looking header strings", () => {
    const c = sanitizeConnectorForSync({
      id: "x",
      kind: "rest",
      name: "X",
      baseUrl: "https://example.com",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer sk-or-v1-secret",
        Ok: { vaultLabel: "my_key" },
      },
    });
    expect(c.headers.Accept).toBe("application/json");
    expect(c.headers.Authorization).toBeUndefined();
    expect(c.headers.Ok).toEqual({ vaultLabel: "my_key" });
  });

  it("round-trips sealed setup pack", async () => {
    const sealed = await sealSetupPack(vault, {
      vaultId: "v1",
      vaultName: "private",
      connectors: [nsFoodRestTemplate({ vaultId: "v1" })],
    });
    const b64 = setupPackToB64(sealed);
    const again = setupPackFromB64(b64);
    const plain = await unsealSetupPack(vault, again);
    expect(plain.vaultId).toBe("v1");
    expect(plain.connectors[0]?.id).toBe("ns-food");
    expect(plain.connectors[0]?.headers.Authorization).toEqual({ vaultLabel: "ns_food_key" });
  });
});
