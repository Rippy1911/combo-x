import { describe, expect, it } from "vitest";
import {
  defaultModelsForProvider,
  looksLikeCloudModelId,
  modelOmitsTemperature,
  normalizeModelId,
  presetsForProvider,
} from "./models.js";

describe("normalizeModelId provider-aware", () => {
  it("keeps openrouter defaults", () => {
    expect(normalizeModelId(null, "openrouter")).toBe("x-ai/grok-4.5");
    expect(normalizeModelId("x-ai/grok-4.5", "openrouter")).toBe("x-ai/grok-4.5");
  });

  it("rewrites cloud id when switching to ollama", () => {
    expect(normalizeModelId("x-ai/grok-4.5", "ollama")).toBe("qwen2.5:32b");
    expect(normalizeModelId("google/gemini-3.5-flash", "ollama")).toBe("qwen2.5:32b");
  });

  it("keeps ollama tags on ollama", () => {
    expect(normalizeModelId("qwen2.5:27b", "ollama")).toBe("qwen2.5:27b");
  });

  it("rewrites ollama tag when on openrouter", () => {
    expect(normalizeModelId("qwen2.5:32b", "openrouter")).toBe("x-ai/grok-4.5");
  });

  it("moonshot bare ids stay", () => {
    expect(normalizeModelId("kimi-k3", "moonshot")).toBe("kimi-k3");
  });

  it("strips OpenRouter moonshotai/ prefix and kimi-latest for Moonshot", () => {
    expect(normalizeModelId("moonshotai/kimi-k2.6", "moonshot")).toBe("kimi-k2.6");
    expect(normalizeModelId("~moonshotai/kimi-latest", "moonshot")).toBe("kimi-k3");
    expect(normalizeModelId("kimi-latest", "moonshot")).toBe("kimi-k3");
  });
});

describe("modelOmitsTemperature", () => {
  it("true for Kimi K2/K3 (fixed sampling)", () => {
    expect(modelOmitsTemperature("kimi-k3")).toBe(true);
    expect(modelOmitsTemperature("kimi-k2.6")).toBe(true);
    expect(modelOmitsTemperature("moonshotai/kimi-k2.7-code")).toBe(true);
    expect(modelOmitsTemperature("x-ai/grok-4.5")).toBe(false);
    expect(modelOmitsTemperature("moonshot-v1-128k")).toBe(false);
  });
});

describe("defaultModelsForProvider", () => {
  it("ollama defaults", () => {
    const d = defaultModelsForProvider("ollama");
    expect(d.orchestrator).toContain("qwen");
    expect(d.worker).toContain("qwen");
  });
});

describe("presetsForProvider", () => {
  it("filters ollama presets", () => {
    const ids = presetsForProvider("ollama").map((p) => p.id);
    expect(ids).toContain("qwen2.5:32b");
    expect(ids).not.toContain("x-ai/grok-4.5");
  });
});

describe("looksLikeCloudModelId", () => {
  it("detects slash ids", () => {
    expect(looksLikeCloudModelId("x-ai/grok-4.5")).toBe(true);
    expect(looksLikeCloudModelId("qwen2.5:32b")).toBe(false);
  });
});
