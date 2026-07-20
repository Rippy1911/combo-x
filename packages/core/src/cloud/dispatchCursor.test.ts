import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_AGENTS_URL,
  dispatchCursorAgent,
  resolveCursorApiKey,
} from "./dispatchCursor.js";

describe("dispatchCursor", () => {
  it("resolveCursorApiKey tries aliases", async () => {
    const get = vi.fn(async (label: string) =>
      label === "CURSOR_API_KEY" ? "key-abc" : null,
    );
    expect(await resolveCursorApiKey(get)).toBe("key-abc");
  });

  it("dispatches to Cursor Agents API", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(CURSOR_AGENTS_URL);
      const body = JSON.parse(String(init?.body));
      expect(body.source.repository).toBe("https://github.com/Rippy1911/combo-x");
      expect(body.target.autoCreatePr).toBe(true);
      expect(body.prompt.text).toContain("Fix");
      return new Response(JSON.stringify({ id: "bc-agent-1" }), { status: 200 });
    });
    const r = await dispatchCursorAgent(
      { prompt: "Fix model picker cost", name: "picker-cost" },
      async () => "sk-cursor-test",
      fetchFn as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.agentId).toBe("bc-agent-1");
      expect(r.watchUrl).toContain("bc-agent-1");
      expect(r.note).toMatch(/Reload/i);
    }
  });

  it("fails clearly without vault key", async () => {
    const r = await dispatchCursorAgent(
      { prompt: "x" },
      async () => null,
      vi.fn() as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cursor_api_key/i);
  });

  it("rejects bad repo shape", async () => {
    const r = await dispatchCursorAgent(
      { prompt: "fix", repo: "not-a-repo" },
      async () => "sk",
      vi.fn() as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner\/repo/);
  });

  it("surfaces Cursor HTTP errors", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "model unavailable" } }), {
          status: 400,
        }),
    );
    const r = await dispatchCursorAgent(
      { prompt: "fix", repo: "Rippy1911/combo-x" },
      async () => "sk",
      fetchFn as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/model unavailable/);
    }
  });
});
