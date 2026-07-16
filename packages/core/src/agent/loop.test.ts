import { describe, expect, it, vi } from "vitest";
import type { OpenRouterClient } from "../llm/openrouter.js";
import { MemoryStore } from "../memory/store.js";
import type { BrowserBridge, ProfileStore, SiteProfile } from "./loop.js";
import { AgentLoop } from "./loop.js";

function mockLlm(
  sequence: Array<{
    content: string | null;
    toolCalls?: Array<{ id: string; name: string; args: string }>;
    model?: string;
  }>,
  onChat?: (model: string) => void,
) {
  let i = 0;
  return {
    chat: vi.fn(async (opts: { model: string }) => {
      onChat?.(opts.model);
      const step = sequence[i] ?? sequence[sequence.length - 1]!;
      i += 1;
      return {
        content: step.content,
        toolCalls: (step.toolCalls ?? []).map((t) => ({
          id: t.id,
          type: "function" as const,
          function: { name: t.name, arguments: t.args },
        })),
        model: step.model ?? opts.model,
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          estimatedCostUsd: 0.0001,
        },
        finishReason: step.toolCalls?.length ? "tool_calls" : "stop",
      };
    }),
  } as unknown as OpenRouterClient;
}

function stubBrowser(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    runContent: vi.fn(async () => ({
      ok: true,
      data: { title: "Example", url: "https://example.com", text: "Hello EAN 590123" },
    })),
    listTabs: vi.fn(async () => []),
    openTab: vi.fn(async (url: string) => ({ id: 1, url })),
    activateTab: vi.fn(async () => ({ ok: true })),
    navigate: vi.fn(async (url: string) => ({ ok: true, url })),
    goBack: vi.fn(async () => ({ ok: true })),
    closeTab: vi.fn(async () => ({ ok: true })),
    downloadText: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("AgentLoop", () => {
  it("runs get_page then answers", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [{ id: "1", name: "get_page", args: "{}" }],
      },
      { content: "The page title is Example." },
    ]);

    const browser = stubBrowser();
    const memory = new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` });
    const agent = new AgentLoop(llm, browser, memory);
    const events: string[] = [];
    const result = await agent.run({
      model: "mock-orch",
      userMessage: "What is this page?",
      onEvent: (e) => events.push(e.type),
    });

    expect(result.finalText).toContain("Example");
    expect(result.aborted).toBe(false);
    expect(result.hitStepLimit).toBe(false);
    expect(result.steps).toBe(2);
    expect(browser.runContent).toHaveBeenCalled();
    expect(events).toContain("tool_start");
    expect(events).toContain("done");
  });

  it("respects abort signal", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [{ id: "1", name: "get_page", args: "{}" }],
      },
    ]);
    const controller = new AbortController();
    controller.abort();
    const agent = new AgentLoop(
      llm,
      stubBrowser(),
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
    );
    const result = await agent.run({
      model: "mock",
      userMessage: "hi",
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });

  it("remember + recall tools hit MemoryStore", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [
          {
            id: "1",
            name: "remember",
            args: JSON.stringify({ text: "Anita prefers morning calls", tags: ["anita"] }),
          },
        ],
      },
      {
        content: null,
        toolCalls: [{ id: "2", name: "recall", args: JSON.stringify({ query: "Anita" }) }],
      },
      { content: "Noted: Anita prefers morning calls." },
    ]);
    const memory = new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` });
    const agent = new AgentLoop(llm, stubBrowser(), memory);
    const result = await agent.run({ model: "mock", userMessage: "save and recall" });
    expect(result.finalText).toMatch(/Anita/);
    const hits = await memory.recall("Anita");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("parse_data uses worker model", async () => {
    const models: string[] = [];
    const llm = mockLlm(
      [
        {
          content: null,
          toolCalls: [
            {
              id: "1",
              name: "parse_data",
              args: JSON.stringify({
                intent: "extract EANs",
                text: "Product A EAN 123",
                schema_hint: "[{name,ean}]",
              }),
            },
          ],
        },
        {
          content: JSON.stringify({ rows: [{ name: "Product A", ean: "123" }], notes: "ok" }),
        },
        { content: "Found 1 product." },
      ],
      (m) => models.push(m),
    );
    const agent = new AgentLoop(
      llm,
      stubBrowser(),
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
    );
    const result = await agent.run({
      model: "orch-model",
      workerModel: "worker-model",
      userMessage: "parse",
    });
    expect(result.finalText).toMatch(/product/i);
    expect(models).toContain("orch-model");
    expect(models).toContain("worker-model");
  });

  it("can navigate via bridge", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [
          {
            id: "1",
            name: "navigate",
            args: JSON.stringify({ url: "https://allegro.pl" }),
          },
        ],
      },
      { content: "Navigated." },
    ]);
    const browser = stubBrowser();
    const agent = new AgentLoop(
      llm,
      browser,
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
    );
    await agent.run({
      model: "mock",
      userMessage: "go",
      approvalMode: "auto_all",
    });
    expect(browser.navigate).toHaveBeenCalledWith("https://allegro.pl");
  });

  function memProfiles(): { store: Map<string, SiteProfile>; profiles: ProfileStore } {
    const store = new Map<string, SiteProfile>();
    const profiles: ProfileStore = {
      get: async (n) => store.get(n) ?? null,
      save: async (p) => {
        store.set(p.name, p);
      },
    };
    return { store, profiles };
  }

  it("scrape_catalog paginates and returns rows", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [
          {
            id: "1",
            name: "scrape_catalog",
            args: JSON.stringify({ selector: ".card", intent: "extract name+ean", maxPages: 1 }),
          },
        ],
      },
      {
        content: JSON.stringify({
          rows: [
            { name: "A", ean: "590" },
            { name: "B", ean: "123" },
          ],
        }),
      },
      { content: "Scraped 2 products." },
    ]);
    const browser = stubBrowser({
      runContent: vi.fn(async () => ({
        ok: true,
        data: { values: ["Item A EAN 590", "Item B EAN 123"] },
      })),
    });
    const agent = new AgentLoop(
      llm,
      browser,
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
    );
    const result = await agent.run({
      model: "orch",
      workerModel: "worker",
      userMessage: "scrape",
      approvalMode: "auto_all",
    });
    expect(result.finalText).toMatch(/2 products/);
  });

  it("save_site_profile + get_site_profile round-trip via ProfileStore", async () => {
    const { store, profiles } = memProfiles();
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [
          {
            id: "1",
            name: "save_site_profile",
            args: JSON.stringify({
              name: "foodwell",
              username: "u",
              password: "p",
              selector: ".card",
              intent: "extract eans",
            }),
          },
        ],
      },
      {
        content: null,
        toolCalls: [{ id: "2", name: "get_site_profile", args: JSON.stringify({ name: "foodwell" }) }],
      },
      { content: "Profile ready." },
    ]);
    const agent = new AgentLoop(
      llm,
      stubBrowser(),
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
      undefined,
      profiles,
    );
    await agent.run({ model: "orch", userMessage: "save and get", approvalMode: "auto_all" });
    expect(store.get("foodwell")?.username).toBe("u");
    expect(store.get("foodwell")?.selector).toBe(".card");
  });

  it("login fills credentials from a saved profile", async () => {
    const { store, profiles } = memProfiles();
    store.set("foodwell", {
      name: "foodwell",
      loginUrl: "https://b2b.foodwell.pl/login",
      username: "u",
      password: "p",
      usernameSelector: "#user",
      passwordSelector: "#pass",
      submitSelector: "#submit",
    });
    const ops: string[] = [];
    const browser = stubBrowser({
      runContent: vi.fn(async (req) => {
        ops.push(req.op);
        return { ok: true, data: {} };
      }),
      navigate: vi.fn(async (url: string) => ({ ok: true, url })),
    });
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [{ id: "1", name: "login", args: JSON.stringify({ profile: "foodwell" }) }],
      },
      { content: "Logged in." },
    ]);
    const agent = new AgentLoop(
      llm,
      browser,
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
      undefined,
      profiles,
    );
    await agent.run({ model: "orch", userMessage: "login", approvalMode: "auto_all" });
    expect(browser.navigate).toHaveBeenCalledWith("https://b2b.foodwell.pl/login");
    expect(ops.filter((c) => c === "type_text").length).toBe(2);
    expect(ops).toContain("click");
  });
});
