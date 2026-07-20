/** Curated model presets (OpenRouter + Moonshot/Kimi + Ollama; vision tags 2026-07). */
import type { LlmProviderId } from "./llm/providers.js";
import { resolveProvider } from "./llm/providers.js";

export const DEFAULT_MODEL = "x-ai/grok-4.5";

/** Cheap worker model for parse_data / structured extract. */
export const DEFAULT_WORKER_MODEL = "google/gemini-3.5-flash";

/** Legacy bad default from Combo-X v0.1 — auto-migrate. */
export const LEGACY_BAD_MODELS = new Set(["x-ai/grok-4.5-fast", "openrouter/x-ai/grok-4.5-fast"]);

export type ModelPreset = {
  id: string;
  label: string;
  hint?: string;
  /** When true, orchestrator may receive image_url (no vision worker). */
  vision?: boolean;
  /** When set, only show in picker fallback for these providers. */
  providers?: LlmProviderId[];
};

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "x-ai/grok-4.5", label: "Grok 4.5", hint: "default", vision: true, providers: ["openrouter"] },
  { id: "x-ai/grok-4.3", label: "Grok 4.3", vision: true, providers: ["openrouter"] },
  { id: "x-ai/grok-4.20", label: "Grok 4.20", vision: true, providers: ["openrouter"] },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", vision: true, providers: ["openrouter"] },
  { id: "anthropic/claude-fable-5", label: "Claude Fable 5", vision: true, providers: ["openrouter"] },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", hint: "cheap", vision: true, providers: ["openrouter"] },
  { id: "openai/gpt-5.5", label: "GPT-5.5", vision: true, providers: ["openrouter"] },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", hint: "cheap", vision: true, providers: ["openrouter"] },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    hint: "vision · cheap",
    vision: true,
    providers: ["openrouter"],
  },
  { id: "gpt-4.1", label: "GPT-4.1", vision: true, providers: ["openai"] },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "cheap", vision: true, providers: ["openai"] },
  // Moonshot / Kimi
  { id: "kimi-k3", label: "Kimi K3", hint: "Moonshot · frontier", vision: true, providers: ["moonshot", "openrouter"] },
  { id: "kimi-k2.6", label: "Kimi K2.6", hint: "Moonshot", vision: true, providers: ["moonshot", "openrouter"] },
  { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", hint: "Moonshot · coding", providers: ["moonshot"] },
  {
    id: "kimi-k2.7-code-highspeed",
    label: "Kimi K2.7 Code Fast",
    hint: "Moonshot · coding · fast",
    providers: ["moonshot"],
  },
  { id: "moonshot-v1-128k", label: "Moonshot v1 128k", hint: "Moonshot · long context", providers: ["moonshot"] },
  // Ollama / local (OpenAI-compat tags)
  { id: "qwen2.5:32b", label: "Qwen 2.5 32B", hint: "Ollama · tools", providers: ["ollama", "custom"] },
  { id: "qwen2.5:27b", label: "Qwen 2.5 27B", hint: "Ollama", providers: ["ollama", "custom"] },
  { id: "qwen2.5:14b", label: "Qwen 2.5 14B", hint: "Ollama · worker", providers: ["ollama", "custom"] },
  { id: "qwen2.5:7b", label: "Qwen 2.5 7B", hint: "Ollama · fast", providers: ["ollama", "custom"] },
  { id: "llama3.2", label: "Llama 3.2", hint: "Ollama", providers: ["ollama", "custom"] },
  { id: "llama3.1:8b", label: "Llama 3.1 8B", hint: "Ollama", providers: ["ollama", "custom"] },
  { id: "mistral", label: "Mistral", hint: "Ollama", providers: ["ollama", "custom"] },
  { id: "llava", label: "LLaVA", hint: "Ollama · vision", vision: true, providers: ["ollama", "custom"] },
  { id: "local-model", label: "local-model", hint: "LM Studio placeholder", providers: ["custom"] },
];

/** Hint shown in Settings — paste any Moonshot/OpenRouter/Ollama model id into the picker search. */
export const MODEL_PASTE_HINT =
  "Paste any model id (e.g. qwen2.5:32b, kimi-k3) into the model picker search — or Refresh after Ollama pull.";

/** OpenRouter-style ids look like org/model; Ollama tags use name:tag. */
export function looksLikeCloudModelId(model: string): boolean {
  return model.includes("/") && !model.startsWith("http");
}

export function looksLikeLocalModelId(model: string): boolean {
  if (!model) return false;
  if (looksLikeCloudModelId(model)) return false;
  return true;
}

export function normalizeModelId(
  model: string | null | undefined,
  providerId?: LlmProviderId | string | null,
): string {
  const provider = resolveProvider(providerId ?? "openrouter");
  if (!model || LEGACY_BAD_MODELS.has(model)) {
    return provider.defaultOrchestratorModel;
  }
  // Switching to Ollama/custom with a leftover OpenRouter id → use local default
  if (provider.local && looksLikeCloudModelId(model)) {
    return provider.defaultOrchestratorModel;
  }
  // Switching to cloud with a bare local tag → use cloud default
  if (!provider.local && looksLikeLocalModelId(model) && !model.includes("kimi") && !model.startsWith("moonshot") && !model.startsWith("gpt-")) {
    // Keep moonshot/openai bare ids; only rewrite obvious ollama tags when on openrouter
    if (provider.id === "openrouter" && (model.includes(":") || model === "llama3.2" || model === "mistral" || model === "llava" || model === "local-model")) {
      return provider.defaultOrchestratorModel;
    }
  }
  return model;
}

export function defaultModelsForProvider(providerId: LlmProviderId | string | null | undefined): {
  orchestrator: string;
  worker: string;
  vision: string;
} {
  const p = resolveProvider(providerId);
  return {
    orchestrator: p.defaultOrchestratorModel,
    worker: p.defaultWorkerModel,
    vision: p.defaultVisionModel ?? p.defaultOrchestratorModel,
  };
}

export function presetsForProvider(providerId: LlmProviderId | string | null | undefined): ModelPreset[] {
  const id = resolveProvider(providerId).id;
  const scoped = MODEL_PRESETS.filter((m) => !m.providers || m.providers.includes(id));
  return scoped.length ? scoped : MODEL_PRESETS;
}
