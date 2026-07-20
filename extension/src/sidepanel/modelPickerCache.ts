import type { OpenRouterModelInfo } from "@combo-x/core";

/** Per-baseUrl cache (1.6.49+). */
export const CACHE_PREFIX = "combo_x_models_cache_v3:";
/** Pre-1.6.49 global OpenRouter cache — migrate into v3 for default OR base. */
export const LEGACY_CACHE_KEY = "combo_x_or_models_cache_v2";
export const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
export const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";

type CacheBlob = { at: number; models: OpenRouterModelInfo[]; baseUrl?: string };

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "") || "default";
}

export function cacheKey(baseUrl: string): string {
  return `${CACHE_PREFIX}${normalizeBaseUrl(baseUrl)}`;
}

function parseFreshBlob(raw: string | null, expectedBase: string): OpenRouterModelInfo[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheBlob;
    if (!parsed?.models?.length || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    if (parsed.baseUrl && parsed.baseUrl !== expectedBase) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

function parseLegacyBlob(raw: string | null): OpenRouterModelInfo[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheBlob;
    if (!parsed?.models?.length || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

/** True when at least one model carries prompt or completion pricing. */
export function modelsHavePricing(models: OpenRouterModelInfo[]): boolean {
  return models.some(
    (m) =>
      (m.promptPrice != null && Number.isFinite(m.promptPrice)) ||
      (m.completionPrice != null && Number.isFinite(m.completionPrice)),
  );
}

/**
 * Load models for a base URL. Migrates legacy v2 OpenRouter cache into v3
 * when the base is the default OpenRouter endpoint (restores prices after 1.6.49).
 */
export function loadCache(
  baseUrl: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): OpenRouterModelInfo[] | null {
  const normalized = normalizeBaseUrl(baseUrl);
  const fresh = parseFreshBlob(storage.getItem(cacheKey(normalized)), normalized);
  if (fresh) return fresh;

  // Legacy v2 was OpenRouter-only and global — only reuse for default OR base.
  if (normalized !== DEFAULT_OPENROUTER_BASE) return null;
  const legacy = parseLegacyBlob(storage.getItem(LEGACY_CACHE_KEY));
  if (!legacy) return null;
  saveCache(DEFAULT_OPENROUTER_BASE, legacy, storage);
  return legacy;
}

export function saveCache(
  baseUrl: string,
  models: OpenRouterModelInfo[],
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    storage.setItem(
      cacheKey(normalized),
      JSON.stringify({
        at: Date.now(),
        models,
        baseUrl: normalized,
      } satisfies CacheBlob),
    );
  } catch {
    /* ignore quota */
  }
}

export function formatPricePerM(perToken?: number): string {
  if (perToken == null || !Number.isFinite(perToken)) return "";
  const perM = perToken * 1_000_000;
  if (perM < 0.01) return `$${perM.toFixed(4)}/M`;
  return `$${perM.toFixed(2)}/M`;
}

/** "prompt / completion" or empty. */
export function formatModelPriceLine(
  m: Pick<OpenRouterModelInfo, "promptPrice" | "completionPrice">,
): string {
  return [formatPricePerM(m.promptPrice), formatPricePerM(m.completionPrice)].filter(Boolean).join(" / ");
}
