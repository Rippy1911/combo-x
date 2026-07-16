import { MODEL_PRESETS, OpenRouterClient, type OpenRouterModelInfo } from "@combo-x/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const CACHE_KEY = "combo_x_or_models_cache_v2";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

type CacheBlob = { at: number; models: OpenRouterModelInfo[] };

function loadCache(): OpenRouterModelInfo[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheBlob;
    if (!parsed?.models?.length || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

function saveCache(models: OpenRouterModelInfo[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), models } satisfies CacheBlob));
  } catch {
    /* ignore */
  }
}

function formatPricePerM(perToken?: number): string {
  if (perToken == null || !Number.isFinite(perToken)) return "";
  const perM = perToken * 1_000_000;
  if (perM < 0.01) return `$${perM.toFixed(4)}/M`;
  return `$${perM.toFixed(2)}/M`;
}

export function ModelPicker({
  value,
  onChange,
  apiKey,
  className,
  title,
  compact,
}: {
  value: string;
  onChange: (id: string) => void;
  apiKey: string;
  className?: string;
  title?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<OpenRouterModelInfo[]>(() => loadCache() ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!apiKey.trim()) {
      setError("API key required to load models");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = new OpenRouterClient({ apiKey: apiKey.trim() });
      const list = await client.listModels();
      setModels(list);
      saveCache(list);
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 120) : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!open) return;
    if (!models.length) void refresh();
    inputRef.current?.focus();
  }, [open, models.length, refresh]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const presetIds = new Set(MODEL_PRESETS.map((p) => p.id));
    const base: OpenRouterModelInfo[] = models.length
      ? models
      : MODEL_PRESETS.map((p) => ({ id: p.id, name: p.label }));
    let rows: OpenRouterModelInfo[] = base;
    if (q) {
      rows = base.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
      );
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
  }, [models, query]);

  const label =
    models.find((m) => m.id === value)?.name ??
    MODEL_PRESETS.find((p) => p.id === value)?.label ??
    value;

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
        <span className="model-picker-id">{value}</span>
      </button>
      {open ? (
        <div className="model-picker-pop" role="listbox">
          <div className="model-picker-search-row">
            <input
              ref={inputRef}
              className="model-picker-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search OpenRouter models…"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered[0]) {
                  onChange(filtered[0].id);
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
            <button type="button" className="msg-action" disabled={loading} onClick={() => void refresh()}>
              {loading ? "…" : "↻"}
            </button>
          </div>
          {error ? <p className="hint wrap">{error}</p> : null}
          <ul className="model-picker-list">
            {filtered.map((m) => {
              const price = [formatPricePerM(m.promptPrice), formatPricePerM(m.completionPrice)]
                .filter(Boolean)
                .join(" / ");
              const presetVision = MODEL_PRESETS.find((p) => p.id === m.id)?.vision;
              const vision = m.supportsVision ?? presetVision;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={m.id === value ? "model-picker-item active" : "model-picker-item"}
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
                    {price ? <span className="model-picker-item-price">{price}</span> : null}
                  </button>
                </li>
              );
            })}
            {!filtered.length ? <li className="hint">No matches</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
