/** LLM provider presets (OpenAI-compatible chat/completions). */

export type LlmProviderId =
  | "openrouter"
  | "openai"
  | "ollama"
  | "moonshot"
  | "custom";

export type LlmProviderPreset = {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  /** Shown in Settings key placeholder. */
  keyPlaceholder: string;
  /** When true, empty API key is OK (sent as Bearer local). */
  keyOptional?: boolean;
  /** Enable OpenRouter server tools (web_search / web_fetch). */
  openRouterServerTools?: boolean;
  hint?: string;
};

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-v1-…",
    openRouterServerTools: true,
    hint: "Default — many models + built-in web search",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-…",
    hint: "Direct OpenAI API",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-… (Moonshot API key)",
    hint: "Kimi models via Moonshot OpenAI-compat (api.moonshot.ai)",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    keyPlaceholder: "(optional)",
    keyOptional: true,
    hint: "Local OpenAI-compatible API",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compat)",
    baseUrl: "http://127.0.0.1:1234/v1",
    keyPlaceholder: "optional key",
    keyOptional: true,
    hint: "LM Studio, vLLM, llama.cpp, etc.",
  },
];

export const LLM_BASE_URL_KEY = "llm_base_url";
export const LLM_PROVIDER_KEY = "llm_provider";
/** Historical vault label — still used for the API key value. */
export const LLM_API_KEY_LABEL = "openrouter_api_key";

export function resolveProvider(id: string | null | undefined): LlmProviderPreset {
  const found = LLM_PROVIDER_PRESETS.find((p) => p.id === id);
  return found ?? LLM_PROVIDER_PRESETS[0]!;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "") || resolveProvider("openrouter").baseUrl;
}
