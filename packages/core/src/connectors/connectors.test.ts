import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpCall, mcpListTools } from "./mcp.js";
import { parseMcpDefinition } from "./secrets.js";
import { resolveHeaders, restRequest } from "./rest.js";
import { ConnectorStore, type McpConnector, type RestConnector } from "./store.js";
import { githubRestTemplate } from "./templates.js";

describe("parseMcpDefinition", () => {
  it("detects Bearer and sk- secrets in JSON", () => {
    const raw = JSON.stringify({
      mcpServers: {
        demo: {
          env: {
            API_KEY: "sk-test-secret-key-12345678",
            Authorization: "Bearer ghp_abcdef1234567890abcdef1234567890",
          },
        },
      },
    });
    const out = parseMcpDefinition(raw);
    expect(out.secrets.length).toBeGreaterThanOrEqual(2);
    expect(out.sanitizedDef).toContain("{vault:");
    expect(out.sanitizedDef).not.toContain("sk-test-secret");
    expect(out.sanitizedDef).not.toContain("ghp_abcdef");
  });

  it("detects password keys in line-oriented config", () => {
    const out = parseMcpDefinition("password: my-super-secret-password-value\nhost: localhost");
    expect(out.secrets).toHaveLength(1);
    expect(out.secrets[0]?.suggestedLabel).toBeTruthy();
    expect(out.sanitizedDef).toContain("{vault:");
  });
});

describe("ConnectorStore", () => {
  it("list get put remove listByKind", async () => {
    const store = new ConnectorStore(`conn_test_${crypto.randomUUID()}`);
    const rest: RestConnector = {
      id: "r1",
      kind: "rest",
      name: "Demo REST",
      baseUrl: "https://api.example.com",
      headers: { "X-Test": "plain" },
    };
    await store.put(rest);
    const mcp: McpConnector = {
      id: "m1",
      kind: "mcp",
      name: "Demo MCP",
      transport: "http",
      url: "https://mcp.example.com/rpc",
      headers: {},
    };
    await store.put(mcp);
    expect((await store.list()).length).toBe(2);
    expect((await store.get("r1"))?.name).toBe("Demo REST");
    expect((await store.listByKind("mcp")).map((c) => c.id)).toEqual(["m1"]);
    expect(await store.remove("r1")).toBe(true);
    expect(await store.get("r1")).toBeNull();
  });
});

describe("resolveHeaders", () => {
  it("resolves SecretRef and adds Bearer for Authorization", async () => {
    const headers = await resolveHeaders(
      { Authorization: { vaultLabel: "github_token" } },
      async (label) => (label === "github_token" ? "ghp_abc" : null),
    );
    expect(headers.Authorization).toBe("Bearer ghp_abc");
  });

  it("does not double-prefix an already-Bearer secret", async () => {
    const headers = await resolveHeaders(
      { Authorization: { vaultLabel: "t" } },
      async () => "Bearer already",
    );
    expect(headers.Authorization).toBe("Bearer already");
  });

  it("passes non-Authorization secret headers through verbatim", async () => {
    const headers = await resolveHeaders(
      { "X-Api-Key": { vaultLabel: "k" } },
      async () => "raw-key",
    );
    expect(headers["X-Api-Key"]).toBe("raw-key");
  });

  it("throws when a referenced secret is missing", async () => {
    await expect(
      resolveHeaders({ Authorization: { vaultLabel: "absent" } }, async () => null),
    ).rejects.toThrow(/vault secret missing: absent/);
  });
});

describe("restRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls connector baseUrl + path", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const connector: RestConnector = {
      id: "r1",
      kind: "rest",
      name: "Test",
      baseUrl: "https://api.example.com",
      headers: {},
    };
    const out = await restRequest(connector, { path: "/v1/items" }, async () => null);
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/items",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("builds query params and JSON body with Content-Type", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const connector: RestConnector = {
      id: "r2",
      kind: "rest",
      name: "T",
      baseUrl: "https://api.example.com/",
      headers: {},
    };
    const out = await restRequest(
      connector,
      { method: "post", path: "items", query: { q: "x", skip: undefined }, body: { a: 1 } },
      async () => null,
    );
    expect(out.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/items?q=x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns a structured error for non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "nope" }), { status: 403 })),
    );
    const connector: RestConnector = {
      id: "r3",
      kind: "rest",
      name: "T",
      baseUrl: "https://api.example.com",
      headers: {},
    };
    const out = await restRequest(connector, { path: "/x" }, async () => null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("REST 403: nope");
  });

  it("surfaces a missing-secret failure as ok:false", async () => {
    const connector: RestConnector = {
      id: "r4",
      kind: "rest",
      name: "T",
      baseUrl: "https://api.example.com",
      headers: { Authorization: { vaultLabel: "absent" } },
    };
    const out = await restRequest(connector, { path: "/x" }, async () => null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/vault secret missing/);
  });
});

describe("mcp remote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mcpListTools posts JSON-RPC tools/list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
          status: 200,
        }),
      ),
    );
    const connector: McpConnector = {
      id: "m1",
      kind: "mcp",
      name: "MCP",
      transport: "http",
      url: "https://mcp.example.com",
      headers: {},
    };
    const out = await mcpListTools(connector, async () => null);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.tools).toEqual({ tools: [] });
  });

  it("rejects SSE transport", async () => {
    const connector: McpConnector = {
      id: "m1",
      kind: "mcp",
      name: "MCP",
      transport: "sse",
      url: "https://mcp.example.com/sse",
      headers: {},
    };
    const out = await mcpCall(connector, "ping", {}, async () => null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("SSE");
  });
});

describe("githubRestTemplate", () => {
  it("returns REST connector with vault Authorization ref", () => {
    const t = githubRestTemplate();
    expect(t.kind).toBe("rest");
    expect(t.baseUrl).toBe("https://api.github.com");
    expect(t.headers.Authorization).toEqual({ vaultLabel: "github_token" });
    expect(t.tools?.length).toBeGreaterThan(0);
  });
});
