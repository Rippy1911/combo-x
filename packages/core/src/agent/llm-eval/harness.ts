import { vi } from "vitest";
import type { BrowserBridge } from "../loop.js";
import type { AgentEvent, SubagentEvent } from "../loop.js";

export function stubBrowser(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    runContent: vi.fn(async () => ({
      ok: true,
      data: {
        title: "Acme Catalog",
        url: "https://shop.example/c",
        text: "Welcome to Acme",
      },
    })),
    listTabs: vi.fn(async () => [
      { id: 1, title: "Home", url: "https://a.test", active: true },
      { id: 2, title: "Cart", url: "https://b.test/cart", active: false },
    ]),
    openTab: vi.fn(async (url: string) => ({ id: 99, url, title: url })),
    activateTab: vi.fn(async () => ({ ok: true })),
    navigate: vi.fn(async (url: string) => ({ ok: true, url })),
    goBack: vi.fn(async () => ({ ok: true })),
    closeTab: vi.fn(async () => ({ ok: true })),
    downloadText: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

export function collectTools(onEvent: (e: AgentEvent) => void) {
  const tools: string[] = [];
  const wrap = (e: AgentEvent) => {
    if (e.type === "tool_start" && e.tool) tools.push(e.tool);
    onEvent(e);
  };
  return { tools, onEvent: wrap };
}

export function mustCall(tools: string[], names: string[]) {
  for (const n of names) {
    if (!tools.includes(n)) {
      throw new Error(`expected tool ${n}; got [${tools.join(", ")}]`);
    }
  }
}

export function mustCallOneOf(tools: string[], names: string[]) {
  if (!names.some((n) => tools.includes(n))) {
    throw new Error(`expected one of [${names.join(", ")}]; got [${tools.join(", ")}]`);
  }
}

export function mustNotCall(tools: string[], names: string[]) {
  for (const n of names) {
    if (tools.includes(n)) {
      throw new Error(`unexpected tool ${n}`);
    }
  }
}

export function finalTextContains(text: string, re: RegExp) {
  if (!re.test(text)) {
    throw new Error(`final text missing ${re}: ${text.slice(0, 200)}`);
  }
}

export type SubagentTrace = { starts: number; dones: number; childTools: string[] };

export function trackSubagents(): {
  trace: SubagentTrace;
  onSubagent: (e: SubagentEvent) => void;
} {
  const trace: SubagentTrace = { starts: 0, dones: 0, childTools: [] };
  return {
    trace,
    onSubagent: (e) => {
      if (e.type === "start") trace.starts += 1;
      if (e.type === "done") {
        trace.dones += 1;
        // Child tools aren't always in parent events — summary check is primary.
      }
    },
  };
}

export const EVAL_SYSTEM = `You are a test agent. ALWAYS use the named tools. Do not invent page content.
When asked to call a tool, call it immediately. Prefer tools over guessing. Be brief.`;
