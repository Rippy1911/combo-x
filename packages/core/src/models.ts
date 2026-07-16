/** Curated OpenRouter model presets (verified live 2026-07-16; vision tags 2026-07-16). */
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
};

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "x-ai/grok-4.5", label: "Grok 4.5", hint: "default", vision: true },
  { id: "x-ai/grok-4.3", label: "Grok 4.3", vision: true },
  { id: "x-ai/grok-4.20", label: "Grok 4.20", vision: true },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", vision: true },
  { id: "anthropic/claude-fable-5", label: "Claude Fable 5", vision: true },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", hint: "cheap", vision: true },
  { id: "openai/gpt-5.5", label: "GPT-5.5", vision: true },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", hint: "cheap", vision: true },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    hint: "vision · cheap",
    vision: true,
  },
];

export function normalizeModelId(model: string | null | undefined): string {
  if (!model || LEGACY_BAD_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
}
