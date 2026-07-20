import {
  OpenRouterClient,
  presetsForProvider,
  resolveProvider,
  type LlmProviderId,
  type OpenRouterModelInfo,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_OPENROUTER_BASE,
  formatModelPriceLine,
  loadCache,
  modelsHavePricing,
  saveCache,
} from "./modelPickerCache";

export type ReadyProvider = {
  id: LlmProviderId;
  label: string;
  apiKey: string;
  baseUrl: string;
  keyOptional?: boolean;
};

type GroupedRow = {
  providerId: LlmProviderId;
  providerLabel: string;
  model: OpenRouterModelInfo;
  local: boolean;
};

export function ModelPicker({
  value,
  onChange,
  apiKey,
  baseUrl,
  providerId,
  keyOptional,
  className,
  title,
  compact,
  multi,
  activeProviderId,
  onSelectProviderModel,
}: {
  value: string;
  onChange: (id: string) => void;
  apiKey: string;
  /** OpenAI-compatible base URL (OpenRouter / Ollama / custom). */
  baseUrl?: string;
  /** Scopes fallback presets (Ollama vs OpenRouter). */
  providerId?: LlmProviderId | string;
  /** Allow listing models without an API key (local servers). */
  keyOptional?: boolean;
  className?: string;
  title?: string;
  compact?: boolean;
  /** When set, list models from every ready provider (chat composer). */
  multi?: ReadyProvider[];
  activeProviderId?: LlmProviderId | string;
  onSelectProviderModel?: (providerId: LlmProviderId, modelId: string) => void;
}) {
  const multiMode = Boolean(multi?.length);
  const resolvedBase = (baseUrl?.trim() || DEFAULT_OPENROUTER_BASE).replace(/\/$/, "");
  const provider = resolveProvider(providerId);
  const isLocal = Boolean(provider.local);
  const fallbackPresets = useMemo(() => presetsForProvider(providerId), [providerId]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<OpenRouterModelInfo[]>(
    () => loadCache(resolvedBase) ?? [],
  );
  const [multiModels, setMultiModels] = useState<Record<string, OpenRouterModelInfo[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastBaseRef = useRef(resolvedBase);
  const prefetchDoneRef = useRef(false);
  const priceRefreshAttemptedRef = useRef(false);
  const multiPrefetchRef = useRef(false);

  // Clear in-memory list when base URL changes (avoid showing OpenRouter list on Ollama)
  useEffect(() => {
    if (multiMode) return;
    if (lastBaseRef.current === resolvedBase) return;
    lastBaseRef.current = resolvedBase;
    prefetchDoneRef.current = false;
    priceRefreshAttemptedRef.current = false;
    setModels(loadCache(resolvedBase) ?? []);
    setError(null);
  }, [resolvedBase, multiMode]);

  const refreshOne = useCallback(
    async (p: ReadyProvider): Promise<OpenRouterModelInfo[]> => {
      const base = p.baseUrl.replace(/\/$/, "");
      if (!p.apiKey.trim() && !p.keyOptional) return [];
      const client = new OpenRouterClient({
        apiKey: p.apiKey.trim() || "local",
        baseUrl: base,
      });
      const list = await client.listModels();
      saveCache(base, list);
      return list;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (multiMode && multi) {
      setLoading(true);
      setError(null);
      try {
        const next: Record<string, OpenRouterModelInfo[]> = {};
        const errors: string[] = [];
        await Promise.all(
          multi.map(async (p) => {
            const base = p.baseUrl.replace(/\/$/, "");
            try {
              const list = await refreshOne(p);
              next[base] = list;
              if (!list.length && p.keyOptional) {
                /* ok — local may be empty until pull */
              }
            } catch (e) {
              next[base] = loadCache(base) ?? [];
              errors.push(
                `${p.label}: ${e instanceof Error ? e.message.slice(0, 80) : "fail"}`,
              );
            }
          }),
        );
        setMultiModels(next);
        if (errors.length) setError(errors.join(" · "));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!apiKey.trim() && !keyOptional) {
      setError("API key required to load models");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = new OpenRouterClient({
        apiKey: apiKey.trim() || "local",
        baseUrl: resolvedBase,
      });
      const list = await client.listModels();
      setModels(list);
      saveCache(resolvedBase, list);
      if (!list.length) {
        setError("0 models — for Ollama run: ollama pull qwen2.5:32b");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 160) : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [apiKey, resolvedBase, keyOptional, multiMode, multi, refreshOne]);

  // Prefetch single-provider
  useEffect(() => {
    if (multiMode) return;
    if (prefetchDoneRef.current) return;
    if (!apiKey.trim() && !keyOptional) return;
    const cached = loadCache(resolvedBase) ?? [];
    if (cached.length && (isLocal || modelsHavePricing(cached))) {
      prefetchDoneRef.current = true;
      return;
    }
    prefetchDoneRef.current = true;
    void refresh();
  }, [apiKey, keyOptional, resolvedBase, isLocal, refresh, multiMode]);

  // Prefetch multi-provider caches
  useEffect(() => {
    if (!multiMode || !multi?.length) return;
    if (multiPrefetchRef.current) return;
    multiPrefetchRef.current = true;
    const seeded: Record<string, OpenRouterModelInfo[]> = {};
    let needFetch = false;
    for (const p of multi) {
      const base = p.baseUrl.replace(/\/$/, "");
      const cached = loadCache(base) ?? [];
      seeded[base] = cached;
      if (!cached.length) needFetch = true;
    }
    setMultiModels(seeded);
    if (needFetch) void refresh();
  }, [multiMode, multi, refresh]);

  useEffect(() => {
    if (!open) {
      priceRefreshAttemptedRef.current = false;
      return;
    }
    if (multiMode) {
      const empty = multi?.some((p) => {
        const base = p.baseUrl.replace(/\/$/, "");
        return !(multiModels[base]?.length);
      });
      if (empty) void refresh();
      inputRef.current?.focus();
      return;
    }
    const needsList = !models.length;
    const needsPrices = !isLocal && models.length > 0 && !modelsHavePricing(models);
    if (needsList) {
      void refresh();
    } else if (needsPrices && !priceRefreshAttemptedRef.current) {
      priceRefreshAttemptedRef.current = true;
      void refresh();
    }
    inputRef.current?.focus();
  }, [open, models, isLocal, refresh, multiMode, multi, multiModels]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const grouped = useMemo((): GroupedRow[] => {
    if (!multiMode || !multi) return [];
    const q = query.trim().toLowerCase();
    const rows: GroupedRow[] = [];
    for (const p of multi) {
      const preset = resolveProvider(p.id);
      const base = p.baseUrl.replace(/\/$/, "");
      const presetIds = new Set(presetsForProvider(p.id).map((x) => x.id));
      const list = multiModels[base]?.length
        ? multiModels[base]!
        : presetsForProvider(p.id).map((x) => ({ id: x.id, name: x.label }));
      let filtered = list;
      if (q) {
        filtered = list.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
        );
      }
      filtered = filtered
        .slice()
        .sort((a, b) => {
          const ap = presetIds.has(a.id) ? 0 : 1;
          const bp = presetIds.has(b.id) ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return a.id.localeCompare(b.id);
        })
        .slice(0, 40);
      for (const model of filtered) {
        rows.push({
          providerId: p.id,
          providerLabel: p.label,
          model,
          local: Boolean(preset.local),
        });
      }
    }
    if (q && !rows.length && q.length > 1 && multi[0]) {
      rows.push({
        providerId: multi[0].id,
        providerLabel: multi[0].label,
        model: { id: query.trim(), name: query.trim() },
        local: Boolean(resolveProvider(multi[0].id).local),
      });
    }
    return rows;
  }, [multiMode, multi, multiModels, query]);

  const filtered = useMemo(() => {
    if (multiMode) return [];
    const q = query.trim().toLowerCase();
    const presetIds = new Set(fallbackPresets.map((p) => p.id));
    const base: OpenRouterModelInfo[] = models.length
      ? models
      : fallbackPresets.map((p) => ({ id: p.id, name: p.label }));
    let rows: OpenRouterModelInfo[] = base;
    if (q) {
      rows = base.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
      );
      if (!rows.length && q.length > 1) {
        rows = [{ id: query.trim(), name: query.trim() }];
      }
    }
    return rows
      .slice()
      .sort((a, b) => {
        const ap = presetIds.has(a.id) ? 0 : 1;
        const bp = presetIds.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 80);
  }, [models, query, fallbackPresets, multiMode]);

  const activePid = resolveProvider(activeProviderId ?? providerId).id;
  const selected =
    (multiMode
      ? grouped.find((r) => r.model.id === value && r.providerId === activePid)?.model
      : models.find((m) => m.id === value)) ??
    models.find((m) => m.id === value);
  const label =
    selected?.name ??
    fallbackPresets.find((p) => p.id === value)?.label ??
    (multiMode
      ? grouped.find((r) => r.model.id === value)?.model.name
      : undefined) ??
    value;
  const selectedPrice =
    formatModelPriceLine(selected ?? {}) ||
    (multiMode
      ? grouped.find((r) => r.model.id === value && r.providerId === activePid)?.local
        ? "local · free"
        : ""
      : isLocal
        ? "local · free"
        : "");
  const providerBadge = multiMode
    ? resolveProvider(activeProviderId ?? providerId).label
    : "";

  const pick = (providerIdPick: LlmProviderId, modelId: string) => {
    if (onSelectProviderModel) onSelectProviderModel(providerIdPick, modelId);
    else onChange(modelId);
    setOpen(false);
    setQuery("");
  };

  let lastSection = "";

  return (
    <div className={`model-picker ${className ?? ""}`} ref={rootRef} title={title}>
      <button
        type="button"
        className={compact ? "model-picker-trigger compact" : "model-picker-trigger"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="model-picker-label">{label}</span>
        {providerBadge ? (
          <span className="model-picker-provider">{providerBadge}</span>
        ) : null}
        <span className="model-picker-id">{value}</span>
        {selectedPrice ? <span className="model-picker-price">{selectedPrice}</span> : null}
      </button>
      {open ? (
        <div className="model-picker-pop" role="listbox">
          <div className="model-picker-search-row">
            <input
              ref={inputRef}
              className="model-picker-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                multiMode
                  ? "Search across providers or paste model id…"
                  : "Search or paste model id…"
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter") {
                  if (multiMode && grouped[0]) {
                    pick(grouped[0].providerId, grouped[0].model.id);
                  } else if (filtered[0]) {
                    onChange(filtered[0].id);
                    setOpen(false);
                    setQuery("");
                  }
                }
              }}
            />
            <button type="button" className="msg-action" disabled={loading} onClick={() => void refresh()}>
              {loading ? "…" : "↻"}
            </button>
          </div>
          {error ? <p className="hint wrap">{error}</p> : null}
          <ul className="model-picker-list">
            {multiMode
              ? grouped.map((row) => {
                  const section =
                    row.providerLabel !== lastSection ? row.providerLabel : null;
                  if (section) lastSection = row.providerLabel;
                  const price =
                    formatModelPriceLine(row.model) ||
                    (row.local ? "local · free" : "");
                  const active =
                    row.model.id === value && row.providerId === activePid;
                  return (
                    <li key={`${row.providerId}:${row.model.id}`}>
                      {section ? (
                        <div className="model-picker-section">{section}</div>
                      ) : null}
                      <button
                        type="button"
                        className={
                          active ? "model-picker-item active" : "model-picker-item"
                        }
                        onClick={() => pick(row.providerId, row.model.id)}
                      >
                        <span className="model-picker-item-name">{row.model.name}</span>
                        <span className="model-picker-item-id">{row.model.id}</span>
                        {price ? (
                          <span className="model-picker-item-price">{price}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              : filtered.map((m) => {
                  const price =
                    formatModelPriceLine(m) ||
                    (isLocal && !modelsHavePricing(models) ? "local · free" : "");
                  const presetVision = fallbackPresets.find((p) => p.id === m.id)?.vision;
                  const vision = m.supportsVision ?? presetVision;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={
                          m.id === value ? "model-picker-item active" : "model-picker-item"
                        }
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <span className="model-picker-item-name">
                          {m.name}
                          {vision ? (
                            <span className="model-vision-badge" title="Vision / image input">
                              {" "}
                              · vision
                            </span>
                          ) : null}
                        </span>
                        <span className="model-picker-item-id">{m.id}</span>
                        {price ? (
                          <span className="model-picker-item-price">{price}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
            {multiMode
              ? !grouped.length && (
                  <li className="hint">No matches — paste an id and press Enter</li>
                )
              : !filtered.length && (
                  <li className="hint">No matches — paste an id and press Enter</li>
                )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
