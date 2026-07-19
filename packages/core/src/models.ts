/** Curated model presets (OpenRouter + Moonshot/Kimi; vision tags 2026-07). */
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
  // Moonshot / Kimi (use with provider = moonshot, base https://api.moonshot.ai/v1)
  {
    id: "kimi-k3",
    label: "Kimi K3",
    hint: "Moonshot · frontier",
    vision: true,
  },
  {
    id: "kimi-k2.6",
    label: "Kimi K2.6",
    hint: "Moonshot",
    vision: true,
  },
  {
    id: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    hint: "Moonshot · coding",
  },
  {
    id: "kimi-k2.7-code-highspeed",
    label: "Kimi K2.7 Code Fast",
    hint: "Moonshot · coding · fast",
  },
  {
    id: "moonshot-v1-128k",
    label: "Moonshot v1 128k",
    hint: "Moonshot · long context",
  },
];

/** Hint shown in Settings — paste any Moonshot/OpenRouter model id into the picker search. */
export const MODEL_PASTE_HINT =
  "Paste any model id (e.g. kimi-k3, moonshot-v1-128k) into the model picker search.";

export function normalizeModelId(model: string | null | undefined): string {
  if (!model || LEGACY_BAD_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
}
