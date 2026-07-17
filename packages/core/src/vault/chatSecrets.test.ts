import { describe, expect, it } from "vitest";
import {
  assignUniqueLabels,
  detectChatSecrets,
  embedSecretsInMessage,
  maskSecretValue,
} from "./chatSecrets.js";

describe("detectChatSecrets", () => {
  it("finds sk- and github tokens", () => {
    const text = "key=sk-or-v1-abcdefghijklmnopqrstuvwxyz123456 password: ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const hits = detectChatSecrets(text);
    expect(hits.some((h) => h.kind === "openai_sk")).toBe(true);
    expect(hits.some((h) => h.kind === "github_pat" || h.value.startsWith("ghp_"))).toBe(true);
  });

  it("finds kv password lines", () => {
    const hits = detectChatSecrets("Use password: SuperSecretPass99 for login");
    expect(hits.some((h) => h.value.includes("SuperSecretPass99"))).toBe(true);
    expect(hits[0]?.suggestedLabel).toMatch(/password|secret/);
  });

  it("ignores vault placeholders", () => {
    expect(detectChatSecrets("login with {vault:foodwell_password}")).toHaveLength(0);
  });
});

describe("embedSecretsInMessage", () => {
  it("replaces values and appends context block", () => {
    const raw = "Login with password SuperSecretPass99 please";
    const out = embedSecretsInMessage(raw, [
      { label: "site_password", value: "SuperSecretPass99", useNote: "FoodWell login" },
    ]);
    expect(out.text).toContain("{vault:site_password}");
    expect(out.text).not.toContain("SuperSecretPass99");
    expect(out.text).toContain("VAULT SECRETS EMBEDDED");
    expect(out.text).toContain("FoodWell login");
    expect(out.replaced).toBe(1);
  });

  it("assignUniqueLabels avoids collisions", () => {
    const embeds = assignUniqueLabels(
      [
        { value: "aaa", suggestedLabel: "api_key", kind: "openai_sk", index: 0 },
        { value: "bbb", suggestedLabel: "api_key", kind: "openai_sk", index: 1 },
      ],
      ["api_key"],
    );
    expect(embeds.map((e) => e.label)).toEqual(["api_key_2", "api_key_3"]);
  });
});

describe("maskSecretValue", () => {
  it("masks middle", () => {
    expect(maskSecretValue("abcdefghij")).toBe("abc…hij");
  });
});
