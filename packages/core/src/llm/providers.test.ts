import { describe, expect, it } from "vitest";
import {
  apiKeyVaultLabel,
  baseUrlCompatibleWithProvider,
  baseUrlVaultLabel,
  coerceProviderBaseUrl,
  isProviderReady,
  LLM_API_KEY_LABEL,
  LLM_BASE_URL_KEY,
  modelVaultLabel,
  normalizeBaseUrl,
  resolveProvider,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  workerModelVaultLabel,
} from "./providers.js";

describe("llm providers", () => {
  it("defaults unknown to openrouter", () => {
    expect(resolveProvider("nope").id).toBe("openrouter");
    expect(resolveProvider("ollama").baseUrl).toContain("11434");
    expect(resolveProvider("moonshot").baseUrl).toBe("https://api.moonshot.ai/v1");
  });

  it("ollama is local with qwen defaults", () => {
    const o = resolveProvider("ollama");
    expect(o.local).toBe(true);
    expect(o.keyOptional).toBe(true);
    expect(o.defaultOrchestratorModel).toContain("qwen");
    expect(o.defaultWorkerModel).toContain("qwen");
  });

  it("normalizes base url", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1");
  });

  it("uses distinct vault labels per provider", () => {
    expect(apiKeyVaultLabel("openrouter")).toBe(LLM_API_KEY_LABEL);
    expect(apiKeyVaultLabel("moonshot")).toBe("moonshot_api_key");
    expect(apiKeyVaultLabel("openai")).toBe("openai_api_key");
    expect(baseUrlVaultLabel("moonshot")).toBe("llm_base_url_moonshot");
    expect(modelVaultLabel("ollama")).toBe("llm_model_ollama");
    expect(workerModelVaultLabel("custom")).toBe("llm_worker_model_custom");
  });

  it("isProviderReady respects keyOptional", () => {
    expect(isProviderReady(resolveProvider("ollama"), "")).toBe(true);
    expect(isProviderReady(resolveProvider("openrouter"), "")).toBe(false);
    expect(isProviderReady(resolveProvider("moonshot"), "sk-x")).toBe(true);
  });

  it("resolveProviderApiKey does not bleed OpenRouter key into Moonshot", async () => {
    const bag: Record<string, string> = {
      [LLM_API_KEY_LABEL]: "sk-or-only",
      moonshot_api_key: "sk-kimi",
    };
    const get = async (l: string) => bag[l] ?? null;
    expect(await resolveProviderApiKey("openrouter", get)).toBe("sk-or-only");
    expect(await resolveProviderApiKey("moonshot", get)).toBe("sk-kimi");
    expect(await resolveProviderApiKey("openai", get)).toBe("");
  });

  it("resolveProviderBaseUrl prefers per-provider then compatible shared for active", async () => {
    const bag: Record<string, string> = {
      llm_provider: "moonshot",
      [LLM_BASE_URL_KEY]: "https://api.moonshot.cn/v1",
      llm_base_url_ollama: "http://192.168.1.5:11434/v1",
    };
    const get = async (l: string) => bag[l] ?? null;
    expect(await resolveProviderBaseUrl("ollama", get)).toBe("http://192.168.1.5:11434/v1");
    expect(await resolveProviderBaseUrl("moonshot", get)).toBe("https://api.moonshot.cn/v1");
    expect(await resolveProviderBaseUrl("openrouter", get)).toBe(
      resolveProvider("openrouter").baseUrl,
    );
  });

  it("resolveProviderBaseUrl ignores OpenRouter leftover when resolving Moonshot", async () => {
    const bag: Record<string, string> = {
      llm_provider: "moonshot",
      [LLM_BASE_URL_KEY]: "https://openrouter.ai/api/v1",
      llm_base_url_moonshot: "https://openrouter.ai/api/v1",
    };
    const get = async (l: string) => bag[l] ?? null;
    expect(await resolveProviderBaseUrl("moonshot", get)).toBe(
      "https://api.moonshot.ai/v1",
    );
  });

  it("coerceProviderBaseUrl rejects cross-provider hosts", () => {
    expect(baseUrlCompatibleWithProvider("https://openrouter.ai/api/v1", "moonshot")).toBe(
      false,
    );
    expect(
      coerceProviderBaseUrl("moonshot", "https://openrouter.ai/api/v1"),
    ).toBe("https://api.moonshot.ai/v1");
    expect(
      coerceProviderBaseUrl("moonshot", "https://api.moonshot.ai/v1/"),
    ).toBe("https://api.moonshot.ai/v1");
  });
});
