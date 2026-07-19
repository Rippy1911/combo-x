import { describe, expect, it } from "vitest";
import {
  ensureGithubRestConnector,
  parseConnectorHeaders,
} from "./ensureGithub.js";
import { ConnectorStore } from "./store.js";
import { githubRestTemplate } from "./templates.js";

describe("parseConnectorHeaders", () => {
  it("parses vault refs and Bearer vault refs", () => {
    expect(parseConnectorHeaders({ Authorization: "{vault:github_pat}" })).toEqual({
      Authorization: { vaultLabel: "github_pat" },
    });
    expect(parseConnectorHeaders({ Authorization: "Bearer {vault:github_token}" })).toEqual({
      Authorization: { vaultLabel: "github_token" },
    });
    expect(parseConnectorHeaders({ Accept: "application/json" })).toEqual({
      Accept: "application/json",
    });
  });

  it("refuses plaintext GitHub PATs", () => {
    expect(() =>
      parseConnectorHeaders({ Authorization: "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789" }),
    ).toThrow(/Refusing to store plaintext/);
  });
});

describe("ensureGithubRestConnector", () => {
  it("creates github-rest from github_pat when github_token empty", async () => {
    const store = new ConnectorStore(`gh-ensure-${crypto.randomUUID()}`);
    const secrets: Record<string, string> = { github_pat: "ghp_test_only" };
    const result = await ensureGithubRestConnector(store, async (l) => secrets[l] ?? null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.vaultLabel).toBe("github_pat");
    const conn = await store.get("github-rest");
    expect(conn?.kind).toBe("rest");
    if (conn?.kind === "rest") {
      expect(conn.headers.Authorization).toEqual({ vaultLabel: "github_pat" });
    }
  });

  it("updates existing connector when vault label differs", async () => {
    const store = new ConnectorStore(`gh-upd-${crypto.randomUUID()}`);
    await store.put(githubRestTemplate({ vaultLabel: "github_token" }));
    const secrets: Record<string, string> = { github_pat: "ghp_test_only" };
    const result = await ensureGithubRestConnector(store, async (l) => secrets[l] ?? null, {
      preferredVaultLabel: "github_pat",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated).toBe(true);
    const conn = await store.get("github-rest");
    if (conn?.kind === "rest") {
      expect(conn.headers.Authorization).toEqual({ vaultLabel: "github_pat" });
    }
  });

  it("errors when no vault PAT present", async () => {
    const store = new ConnectorStore(`gh-miss-${crypto.randomUUID()}`);
    const result = await ensureGithubRestConnector(store, async () => null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/No GitHub PAT/);
  });
});
