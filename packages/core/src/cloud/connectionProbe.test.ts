import { describe, expect, it, vi } from "vitest";
import {
  normalizeComboApiBase,
  probeComboApi,
  probeLlmEndpoint,
} from "./connectionProbe.js";

describe("normalizeComboApiBase", () => {
  it("adds http for bare host:port", () => {
    expect(normalizeComboApiBase("192.168.1.10:8050", "https://api.example")).toBe(
      "http://192.168.1.10:8050",
    );
  });
  it("strips trailing slash", () => {
    expect(normalizeComboApiBase("http://localhost:8050/", "x")).toBe("http://localhost:8050");
  });
  it("falls back when empty", () => {
    expect(normalizeComboApiBase("  ", "https://api.combo.nextsolutions.studio")).toBe(
      "https://api.combo.nextsolutions.studio",
    );
  });
});

describe("probeComboApi", () => {
  it("reports ok on health", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, service: "combo-platform", version: "0.2.0", db: "ok" }), {
        status: 200,
      }),
    );
    const r = await probeComboApi("http://192.168.1.5:8050", fetchFn as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("combo-platform");
    const call = fetchFn.mock.calls[0] as unknown as [string];
    expect(call[0]).toBe("http://192.168.1.5:8050/v1/health");
  });

  it("fails on network error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const r = await probeComboApi("http://127.0.0.1:9", fetchFn as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Failed to fetch");
  });
});

describe("probeLlmEndpoint", () => {
  it("lists ollama models", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5:32b" }, { id: "llama3.2" }],
        }),
        { status: 200 },
      ),
    );
    const r = await probeLlmEndpoint(
      { baseUrl: "http://127.0.0.1:11434/v1", keyOptional: true },
      fetchFn as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    expect(r.modelCount).toBe(2);
    expect(r.sampleIds?.[0]).toBe("qwen2.5:32b");
  });
});
