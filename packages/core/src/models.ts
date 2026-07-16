/** Curated OpenRouter model presets (verified live 2026-07-16). */
export const DEFAULT_MODEL = "x-ai/grok-4.5";

/** Cheap worker model for parse_data / structured extract. */
export const DEFAULT_WORKER_MODEL = "google/gemini-3.5-flash";

/** Legacy bad default from Combo-X v0.1 — auto-migrate. */
export const LEGACY_BAD_MODELS = new Set(["x-ai/grok-4.5-fast", "openrouter/x-ai/grok-4.5-fast"]);

export const MODEL_PRESETS: Array<{ id: string; label: string; hint?: string }> = [
  { id: "x-ai/grok-4.5", label: "Grok 4.5", hint: "default" },
  { id: "x-ai/grok-4.3", label: "Grok 4.3" },
  { id: "x-ai/grok-4.20", label: "Grok 4.20" },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "anthropic/claude-fable-5", label: "Claude Fable 5" },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", hint: "cheap" },
  { id: "openai/gpt-5.5", label: "GPT-5.5" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", hint: "cheap" },
];

export function normalizeModelId(model: string | null | undefined): string {
  if (!model || LEGACY_BAD_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
}
