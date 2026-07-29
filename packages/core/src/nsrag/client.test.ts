import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NS_RAG_BASE,
  NS_RAG_API_KEY_LABEL,
  normalizeRagBase,
  portfolioAsk,
  portfolioSearch,
} from "./client.js";

const KEY = "test-ns-rag-secret-key-xyz";

function vault(map: Record<string, string | null> = { [NS_RAG_API_KEY_LABEL]: KEY }) {
  return async (label: string) => map[label] ?? null;
}

describe("normalizeRagBase", () => {
  it("falls back for blank", () => {
    expect(normalizeRagBase("")).toBe(DEFAULT_NS_RAG_BASE);
    expect(normalizeRagBase("   ")).toBe(DEFAULT_NS_RAG_BASE);
    expect(normalizeRagBase(null)).toBe(DEFAULT_NS_RAG_BASE);
    expect(normalizeRagBase(undefined)).toBe(DEFAULT_NS_RAG_BASE);
  });

  it("prepends https when no scheme", () => {
    expect(normalizeRagBase("rag.example.com")).toBe("https://rag.example.com");
  });

  it("strips trailing slashes", () => {
    expect(normalizeRagBase("https://rag.example.com///")).toBe("https://rag.example.com");
  });
});

describe("portfolioAsk", () => {
  it("POSTs /ask with bearer + body and maps sources", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${DEFAULT_NS_RAG_BASE}/ask`);
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(JSON.parse(String(init?.body))).toEqual({ query: "what is ns-agent?", k: 8 });
      return new Response(
        JSON.stringify({
          answer: "ns-agent is the portfolio agent runtime.",
          model: "z-ai/glm-5.2",
          embeddings: "cfai",
          sources: [
            {
              source_path: "_memory/context.md",
              section: "Active plan",
              score: 0.42,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const r = await portfolioAsk("what is ns-agent?", {
      getSecret: vault(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.answer).toMatch(/ns-agent/);
    expect(r.citations).toEqual([
      { path: "_memory/context.md", heading: "Active plan", score: 0.42, snippet: undefined },
    ]);
  });

  it("missing key returns vault error and never leaks key", async () => {
    const fetchImpl = vi.fn();
    const r = await portfolioAsk("q", {
      getSecret: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ns_rag_api_key missing in vault");
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("non-2xx → ns_rag_<status>", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    const r = await portfolioAsk("q", {
      getSecret: vault(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ns_rag_401");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("network throw resolves ok:false", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const r = await portfolioAsk("q", {
      getSecret: vault(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/fetch failed/);
  });

  it("truncates long snippets to 500", async () => {
    const long = "x".repeat(600);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answer: "ok",
            sources: [{ source_path: "a.md", snippet: long, score: 1 }],
          }),
          { status: 200 },
        ),
    );
    const r = await portfolioAsk("q", {
      getSecret: vault(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.citations?.[0]?.snippet?.length).toBe(500);
  });
});

describe("portfolioSearch", () => {
  it("POSTs /v1/mcp JSON-RPC and unwraps content text JSON", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${DEFAULT_NS_RAG_BASE}/v1/mcp`);
      const body = JSON.parse(String(init?.body));
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("tools/call");
      expect(body.params).toEqual({
        name: "search_portfolio",
        arguments: { query: "combo vault", k: 5 },
      });
      const hits = [
        {
          source_path: "_docs/reports/01-portfolio-snapshot.md",
          section: "Combo",
          score: 0.91,
          snippet: "Combo API 0.3.0",
        },
      ];
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
          },
        }),
        { status: 200 },
      );
    });

    const r = await portfolioSearch(
      "combo vault",
      { getSecret: vault(), fetchImpl: fetchImpl as unknown as typeof fetch },
      { k: 5 },
    );
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([
      {
        path: "_docs/reports/01-portfolio-snapshot.md",
        heading: "Combo",
        score: 0.91,
        snippet: "Combo API 0.3.0",
      },
    ]);
  });

  it("non-2xx → ns_rag_<status>", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const r = await portfolioSearch("q", {
      getSecret: vault(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ns_rag_503");
    expect(String(r.error)).not.toContain(KEY);
  });

  it("truncates search snippets to 500", async () => {
    const long = "y".repeat(550);
    const fetchImpl = vi.fn(async () => {
      const hits = [{ source_path: "b.md", snippet: long, score: 0.1 }];
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: JSON.stringify(hits) }] },
        }),
        { status: 200 },
      );
    });
    const r = await portfolioSearch("q", {
      getSecret: vault(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.hits?.[0]?.snippet?.length).toBe(500);
  });
});
