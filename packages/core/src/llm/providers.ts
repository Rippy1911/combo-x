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
  /** Applied when switching to this provider if current model looks wrong. */
  defaultOrchestratorModel: string;
  defaultWorkerModel: string;
  defaultVisionModel?: string;
  /** Hint for agent UX — local models may need tool-capable tags. */
  local?: boolean;
};

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-v1-…",
    openRouterServerTools: true,
    hint: "Default — many models + built-in web search",
    defaultOrchestratorModel: "x-ai/grok-4.5",
    defaultWorkerModel: "google/gemini-3.5-flash",
    defaultVisionModel: "x-ai/grok-4.5",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-…",
    hint: "Direct OpenAI API",
    defaultOrchestratorModel: "gpt-4.1",
    defaultWorkerModel: "gpt-4.1-mini",
    defaultVisionModel: "gpt-4.1",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-… (Moonshot API key)",
    hint: "Kimi models via Moonshot OpenAI-compat (api.moonshot.ai)",
    defaultOrchestratorModel: "kimi-k3",
    defaultWorkerModel: "kimi-k2.6",
    defaultVisionModel: "kimi-k3",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    keyPlaceholder: "(optional)",
    keyOptional: true,
    local: true,
    hint: "Local OpenAI-compat — e.g. qwen2.5:32b, qwen2.5:27b, llama3.2. Pull first: ollama pull <model>",
    defaultOrchestratorModel: "qwen2.5:32b",
    defaultWorkerModel: "qwen2.5:14b",
    defaultVisionModel: "llava",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compat)",
    baseUrl: "http://127.0.0.1:1234/v1",
    keyPlaceholder: "optional key",
    keyOptional: true,
    local: true,
    hint: "LM Studio, vLLM, llama.cpp — set Base URL to your LAN host if needed",
    defaultOrchestratorModel: "local-model",
    defaultWorkerModel: "local-model",
  },
];

export const LLM_BASE_URL_KEY = "llm_base_url";
export const LLM_PROVIDER_KEY = "llm_provider";
/** Historical vault label for OpenRouter (and pre-1.6.55 single-key era). */
export const LLM_API_KEY_LABEL = "openrouter_api_key";
/** Active orchestrator / worker model pointers (legacy names kept). */
export const LLM_ACTIVE_MODEL_LABEL = "openrouter_model";
export const LLM_ACTIVE_WORKER_MODEL_LABEL = "openrouter_worker_model";

const API_KEY_LABELS: Record<LlmProviderId, string> = {
  openrouter: LLM_API_KEY_LABEL,
  openai: "openai_api_key",
  moonshot: "moonshot_api_key",
  ollama: "ollama_api_key",
  custom: "custom_api_key",
};

/** Vault label for this provider's API key (OpenRouter keeps legacy name). */
export function apiKeyVaultLabel(id: LlmProviderId | string): string {
  const p = resolveProvider(id);
  return API_KEY_LABELS[p.id];
}

/** Per-provider base URL override. */
export function baseUrlVaultLabel(id: LlmProviderId | string): string {
  return `llm_base_url_${resolveProvider(id).id}`;
}

/** Last orchestrator model used with this provider. */
export function modelVaultLabel(id: LlmProviderId | string): string {
  return `llm_model_${resolveProvider(id).id}`;
}

/** Last worker model used with this provider. */
export function workerModelVaultLabel(id: LlmProviderId | string): string {
  return `llm_worker_model_${resolveProvider(id).id}`;
}

export function isProviderReady(
  preset: LlmProviderPreset,
  key: string | null | undefined,
): boolean {
  if (preset.keyOptional) return true;
  return Boolean(key?.trim());
}

/**
 * Resolve API key for a provider from vault-style getters.
 * OpenRouter: `openrouter_api_key` only.
 * Others: provider label, with no fallback to the OpenRouter key (avoids clobber confusion).
 */
export async function resolveProviderApiKey(
  id: LlmProviderId | string,
  getByLabel: (label: string) => Promise<string | null>,
): Promise<string> {
  const label = apiKeyVaultLabel(id);
  return (await getByLabel(label))?.trim() || "";
}

/**
 * Resolve base URL for a provider: per-provider label, then shared `llm_base_url`
 * only when that provider is the currently stored active provider, else preset default.
 */
export async function resolveProviderBaseUrl(
  id: LlmProviderId | string,
  getByLabel: (label: string) => Promise<string | null>,
  opts?: { activeProviderId?: string | null },
): Promise<string> {
  const preset = resolveProvider(id);
  const specific = (await getByLabel(baseUrlVaultLabel(preset.id)))?.trim();
  if (specific) return normalizeBaseUrl(specific);
  const activeId = opts?.activeProviderId ?? (await getByLabel(LLM_PROVIDER_KEY));
  if (resolveProvider(activeId).id === preset.id) {
    const shared = (await getByLabel(LLM_BASE_URL_KEY))?.trim();
    if (shared) return normalizeBaseUrl(shared);
  }
  return normalizeBaseUrl(preset.baseUrl);
}

export function resolveProvider(id: string | null | undefined): LlmProviderPreset {
  const found = LLM_PROVIDER_PRESETS.find((p) => p.id === id);
  return found ?? LLM_PROVIDER_PRESETS[0]!;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "") || resolveProvider("openrouter").baseUrl;
}
