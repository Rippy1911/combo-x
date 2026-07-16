/**
 * LIVE LLM eval — skipped unless COMBO_X_LLM_EVAL=1 + OPENROUTER_API_KEY.
 * Uses google/gemini-2.5-flash-lite by default. Stubbed BrowserBridge + real OpenRouter.
 */
import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient } from "../../llm/openrouter.js";
import { MemoryStore } from "../../memory/store.js";
import { SkillStore } from "../../skills/store.js";
import { AgentLoop } from "../loop.js";
import { evalMaxUsd, evalModel, llmEvalEnabled, resolveOpenRouterKey } from "./gate.js";
import {
  EVAL_SYSTEM,
  collectTools,
  finalTextContains,
  mustCall,
  mustCallOneOf,
  mustNotCall,
  stubBrowser,
  trackSubagents,
} from "./harness.js";

const live = llmEvalEnabled();

describe.skipIf(!live)("AgentLoop LIVE LLM eval (cheap model)", () => {
  const model = evalModel();
  const key = resolveOpenRouterKey()!;
  let suiteCost = 0;

  async function runScenario(input: {
    userMessage: string;
    enabledTools: string[];
    maxSteps?: number;
    browser?: ReturnType<typeof stubBrowser>;
    skills?: boolean;
    onSubagent?: Parameters<AgentLoop["run"]>[0]["onSubagent"];
  }) {
    const llm = new OpenRouterClient({ apiKey: key, title: "Combo-X LLM Eval" });
    const browser = input.browser ?? stubBrowser();
    const memory = new MemoryStore({ dbName: `llm_eval_${crypto.randomUUID()}` });
    const skills = input.skills
      ? new SkillStore({ dbName: `llm_eval_skills_${crypto.randomUUID()}` })
      : undefined;
    const agent = new AgentLoop(llm, browser, memory);
    const { tools, onEvent } = collectTools(() => undefined);
    const result = await agent.run({
      model,
      workerModel: model,
      userMessage: input.userMessage,
      enabledTools: input.enabledTools,
      toolMode: "static",
      skills,
      approvalMode: "auto_all",
      maxSteps: input.maxSteps ?? 4,
      systemPrompt: EVAL_SYSTEM,
      onEvent,
      onSubagent: input.onSubagent,
    });
    suiteCost += result.usage.estimatedCostUsd;
    expect(suiteCost).toBeLessThanOrEqual(evalMaxUsd());
    return { result, tools, browser, memory };
  }

  it(
    "S1 get_page returns fixture title",
    async () => {
      const { result, tools } = await runScenario({
        userMessage: "What is the title of the current page? Use get_page.",
        enabledTools: ["get_page"],
      });
      mustCall(tools, ["get_page"]);
      mustNotCall(tools, ["navigate", "spawn_subagent"]);
      finalTextContains(result.finalText, /Acme Catalog/i);
    },
    90_000,
  );

  it(
    "S2 navigate to fixed URL",
    async () => {
      const browser = stubBrowser();
      const { result, tools } = await runScenario({
        userMessage:
          "Navigate to https://example.com/hello using the navigate tool, then stop.",
        enabledTools: ["navigate"],
        browser,
      });
      mustCall(tools, ["navigate"]);
      expect(browser.navigate).toHaveBeenCalled();
      const navArg = String((browser.navigate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "");
      expect(navArg).toMatch(/example\.com\/hello/);
      // Cheap models sometimes end with empty text after the tool — tool call is the contract.
      void result;
    },
    90_000,
  );

  it(
    "S3 list_tabs names titles",
    async () => {
      const { result, tools } = await runScenario({
        userMessage: "List open browser tabs with list_tabs and name their titles.",
        enabledTools: ["list_tabs"],
      });
      mustCall(tools, ["list_tabs"]);
      finalTextContains(result.finalText, /Home/);
      finalTextContains(result.finalText, /Cart/);
    },
    90_000,
  );

  it(
    "S4 remember then recall",
    async () => {
      const { result, tools, memory } = await runScenario({
        userMessage:
          'Save memory text exactly: "EvalUser prefers kg units". Then recall "EvalUser" and confirm the preference.',
        enabledTools: ["remember", "save_memory", "recall"],
        maxSteps: 6,
      });
      mustCallOneOf(tools, ["remember", "save_memory"]);
      mustCall(tools, ["recall"]);
      finalTextContains(result.finalText, /kg/i);
      const hits = await memory.recall("EvalUser", 5);
      expect(hits.length).toBeGreaterThan(0);
    },
    90_000,
  );

  it(
    "S5 parse_data extracts EAN",
    async () => {
      const { result, tools } = await runScenario({
        userMessage:
          'Use parse_data on this text: "Widget EAN 5901234567890". Extract name and ean as JSON rows.',
        enabledTools: ["parse_data"],
        maxSteps: 5,
      });
      mustCall(tools, ["parse_data"]);
      finalTextContains(result.finalText, /5901234567890/);
    },
    90_000,
  );

  it(
    "S6 spawn_subagent reads page title",
    async () => {
      const { trace, onSubagent } = trackSubagents();
      const { result, tools } = await runScenario({
        userMessage:
          'Spawn a subagent whose only job is: read the current page with get_page and return the page title. Use spawn_subagent with tools:["get_page"] and maxSteps:3.',
        enabledTools: ["spawn_subagent", "get_page", "list_agents"],
        maxSteps: 6,
        onSubagent,
      });
      mustCall(tools, ["spawn_subagent"]);
      expect(trace.starts).toBeGreaterThanOrEqual(1);
      expect(trace.dones).toBeGreaterThanOrEqual(1);
      finalTextContains(result.finalText, /Acme Catalog/i);
    },
    120_000,
  );
});
