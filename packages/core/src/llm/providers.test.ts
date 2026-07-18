import { describe, expect, it } from "vitest";
import { normalizeBaseUrl, resolveProvider } from "./providers.js";

describe("llm providers", () => {
  it("defaults unknown to openrouter", () => {
    expect(resolveProvider("nope").id).toBe("openrouter");
    expect(resolveProvider("ollama").baseUrl).toContain("11434");
    expect(resolveProvider("moonshot").baseUrl).toBe("https://api.moonshot.ai/v1");
  });

  it("normalizes base url", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1");
  });
});
