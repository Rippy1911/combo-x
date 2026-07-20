import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorStore } from "../connectors/store.js";
import { Vault } from "../vault/vault.js";
import {
  applySetupBundle,
  applyUpsertConnectors,
  applyVaultDeleteSecrets,
  applyVaultPutSecrets,
} from "./vaultAdmin.js";

describe("vaultAdmin", () => {
  let vault: Vault;
  let store: ConnectorStore;

  beforeEach(() => {
    vault = new Vault({ dbName: `va_${crypto.randomUUID()}` });
    store = new ConnectorStore(`cs_${crypto.randomUUID()}`);
  });

  it("puts and deletes secrets by label", async () => {
    await vault.setPassphrase("pass");
    const put = await applyVaultPutSecrets(vault, [
      { label: "cursor_api_key", value: "sk-test" },
      { label: "  ", value: "skip" },
    ]);
    expect(put.ok).toBe(true);
    if (put.ok) expect(put.written).toEqual(["cursor_api_key"]);
    await expect(vault.getByLabel("cursor_api_key")).resolves.toBe("sk-test");

    const del = await applyVaultDeleteSecrets(vault, ["cursor_api_key", "missing"]);
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.deleted).toEqual(["cursor_api_key"]);
    await expect(vault.getByLabel("cursor_api_key")).resolves.toBeNull();
  });

  it("upserts connectors with vaultId", async () => {
    const up = await applyUpsertConnectors(
      store,
      [
        {
          id: "gh",
          kind: "rest",
          name: "GitHub",
          baseUrl: "https://api.github.com",
          headers: { Authorization: "Bearer {vault:github_token}" },
        },
      ],
      "work",
    );
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.ids).toEqual(["gh"]);
    const row = await store.get("gh");
    expect(row?.vaultId).toBe("work");
    expect(row?.kind).toBe("rest");
    if (row?.kind === "rest") expect(row.baseUrl).toBe("https://api.github.com");
  });

  it("applySetupBundle writes recipe secrets + connectors", async () => {
    await vault.setPassphrase("pass");
    const r = await applySetupBundle(
      vault,
      store,
      {
        recipeId: "work",
        secrets: { github_token: "ghp_test" },
      },
      "work",
    );
    expect(r.ok).toBe(true);
    await expect(vault.getByLabel("github_token")).resolves.toBe("ghp_test");
    const list = await store.list();
    expect(list.some((c) => c.id === "github-rest" || c.id === "gh")).toBe(true);
  });
});
