import { describe, expect, it } from "vitest";
import {
  CACHE_PREFIX,
  DEFAULT_OPENROUTER_BASE,
  LEGACY_CACHE_KEY,
  formatModelPriceLine,
  loadCache,
  modelsHavePricing,
  saveCache,
} from "./modelPickerCache";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("modelPickerCache", () => {
  it("migrates legacy v2 OpenRouter cache into v3 with prices", () => {
    const models = [
      {
        id: "x-ai/grok-4.5",
        name: "Grok 4.5",
        promptPrice: 0.000001,
        completionPrice: 0.000003,
      },
    ];
    const storage = memoryStorage({
      [LEGACY_CACHE_KEY]: JSON.stringify({ at: Date.now(), models }),
    });
    const loaded = loadCache(DEFAULT_OPENROUTER_BASE, storage);
    expect(loaded?.[0]?.promptPrice).toBe(0.000001);
    expect(modelsHavePricing(loaded!)).toBe(true);
    const v3 = storage.getItem(`${CACHE_PREFIX}${DEFAULT_OPENROUTER_BASE}`);
    expect(v3).toBeTruthy();
    expect(JSON.parse(v3!).models[0].completionPrice).toBe(0.000003);
  });

  it("does not apply legacy v2 cache to Ollama base", () => {
    const storage = memoryStorage({
      [LEGACY_CACHE_KEY]: JSON.stringify({
        at: Date.now(),
        models: [{ id: "x-ai/grok-4.5", name: "Grok", promptPrice: 1 }],
      }),
    });
    expect(loadCache("http://127.0.0.1:11434/v1", storage)).toBeNull();
  });

  it("round-trips v3 cache per baseUrl", () => {
    const storage = memoryStorage();
    const models = [{ id: "a", name: "A", promptPrice: 0.000002 }];
    saveCache("https://openrouter.ai/api/v1/", models, storage);
    const loaded = loadCache("https://openrouter.ai/api/v1", storage);
    expect(loaded?.[0]?.promptPrice).toBe(0.000002);
    expect(formatModelPriceLine(loaded![0]!)).toBe("$2.00/M");
  });
});
