import {
  coerceProviderBaseUrl,
  OpenRouterClient,
  resolveProvider,
  type LlmProviderId,
} from "@combo-x/core";

export function buildLlmClient(opts: {
  apiKey: string;
  provider: LlmProviderId | string;
  baseUrl: string;
  webSearchEnabled: boolean;
}): OpenRouterClient {
  const preset = resolveProvider(opts.provider);
  // Coerce so a stale OpenRouter base never carries a Moonshot key.
  const baseUrl = coerceProviderBaseUrl(opts.provider, opts.baseUrl);
  const enableOpenRouterServerTools =
    Boolean(preset.openRouterServerTools) && opts.webSearchEnabled !== false;
  return new OpenRouterClient({
    apiKey: opts.apiKey.trim() || (preset.keyOptional ? "local" : opts.apiKey),
    baseUrl,
    enableOpenRouterServerTools,
  });
}

/** Omit Combo web_search/web_fetch when search is off, or when OpenRouter server tools own it. */
export function shouldOmitComboWebSearch(
  provider: LlmProviderId | string,
  webSearchEnabled: boolean,
): boolean {
  if (webSearchEnabled === false) return true;
  const preset = resolveProvider(provider);
  return Boolean(preset.openRouterServerTools);
}
