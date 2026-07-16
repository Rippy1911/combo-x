import { githubGetFile, githubSearchCode, type GitHubConfig } from "../connectors/github.js";
import { ideaforgeSearch, type IdeaForgeConfig } from "../connectors/ideaforge.js";
import { ArtifactStore, buildReportHtml } from "../local/artifacts.js";
import type { ChatMessage, ChatResult, LlmUsage, OpenRouterClient, ToolCall } from "../llm/openrouter.js";
import type { MemoryStore } from "../memory/store.js";
import { DEFAULT_WORKER_MODEL } from "../models.js";
import { SENSITIVE_TOOLS } from "../protocol/messages.js";
import type { ContentRequest, ContentResponse } from "../protocol/messages.js";
import type { RagStore } from "../rag/store.js";
import type { SessionStore } from "../sessions/store.js";
import { AGENT_TOOLS, parseToolArguments, rowsToCsv, toolArgsToContentRequest } from "../browser/tools.js";

export type ApprovalMode = "ask" | "auto_llm" | "auto_all";

export interface BrowserBridge {
  runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse>;
  listTabs(): Promise<Array<{ id: number; title: string; url: string }>>;
  openTab(url: string, active?: boolean): Promise<{ id: number; url: string }>;
  activateTab(tabId: number): Promise<{ ok: boolean }>;
  navigate(url: string, tabId?: number): Promise<{ ok: boolean; url: string }>;
  goBack(tabId?: number): Promise<{ ok: boolean }>;
  closeTab(tabId: number): Promise<{ ok: boolean }>;
  downloadText(filename: string, text: string, mime?: string): Promise<{ ok: boolean }>;
}

/** A saved site login + scrape recipe, stored encrypted in the vault as `site_profile:<name>`. */
export interface SiteProfile {
  name: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  selector?: string;
  nextSelector?: string;
  nextText?: string;
  intent?: string;
  schemaHint?: string;
}

/** Vault-backed profile store; App.tsx wires this to Vault labels. */
export interface ProfileStore {
  get(name: string): Promise<SiteProfile | null>;
  save(profile: SiteProfile): Promise<void>;
}

export interface AgentEvent {
  type:
    | "status"
    | "tool_start"
    | "tool_result"
    | "tool_approval"
    | "assistant_delta"
    | "done"
    | "error"
    | "usage";
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  usage?: LlmUsage;
  toolCallId?: string;
  /** orchestrator | worker | approval */
  usageSource?: "orchestrator" | "worker" | "approval";
  resolve?: (allow: boolean) => void;
}

export interface ConnectorBundle {
  ideaforge?: IdeaForgeConfig | null;
  github?: GitHubConfig | null;
}

export interface AgentRunOptions {
  model: string;
  /** Cheap model for parse_data (and optional approval) */
  workerModel?: string;
  userMessage: string;
  history?: ChatMessage[];
  maxSteps?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
  enabledTools?: string[];
  approvalMode?: ApprovalMode;
  approvalModel?: string;
  onEvent?: (event: AgentEvent) => void;
  /** Local folder RAG index (IndexedDB) */
  rag?: RagStore;
  /** Live read-only connectors */
  connectors?: ConnectorBundle;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  finalText: string;
  steps: number;
  usage: LlmUsage;
  aborted: boolean;
  hitStepLimit: boolean;
}

const DEFAULT_SYSTEM = `You are Combo-X, a local-first browser agent (orchestrator).
You CAN open tabs (open_tab), navigate the current tab (navigate), go_back, and close_tab.
For interaction prefer get_interactive → click_index / type_index (Nanobrowser-style indices) over guessing CSS.
For catalogs/scrapes: scroll + query_all or scrape_tables, then parse_data (cheap worker LLM) to structure rows, then export_csv.
For a WHOLE catalog in one call: scrape_catalog (paginates all pages, calls the worker per page, dedupes, returns rows) — then export_csv.
Login + recipe reuse without re-entering: save_site_profile once (name, loginUrl, username, password, selectors, selector, nextSelector|nextText, intent) — then login {profile} and scrape_catalog {profile} reuse it. Use get_site_profile to recall a recipe.
For codebase questions: rag_search / rag_read_file against the granted local folder; ideaforge_search for portfolio knowledge; github_search_code / github_get_file when a GitHub token is configured.
Rules:
- Prefer get_interactive or query_all over dumping huge get_page text into your own context.
- Prefer rag_search over inventing file contents.
- After click/navigate, wait briefly then re-read.
- Never invent page content — use tools.
- Be concise in the final answer.`;

const PARSE_SYSTEM = `You extract structured data from untrusted page text.
Reply with ONLY valid JSON: {"rows":[...],"notes":"optional short note"}.
rows must match the user's intent / schema_hint. No markdown fences.`;

function sumUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  };
}

const ZERO: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
};

function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    return { rows: [], notes: "parse_failed", raw: body.slice(0, 500) };
  }
}

function strOpt(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class AgentLoop {
  private readonly artifacts = new ArtifactStore();

  constructor(
    private readonly llm: OpenRouterClient,
    private readonly browser: BrowserBridge,
    private readonly memory: MemoryStore,
    private readonly sessions?: SessionStore,
    private readonly profiles?: ProfileStore,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? 32;
    const approvalMode = options.approvalMode ?? "ask";
    const workerModel = options.workerModel ?? DEFAULT_WORKER_MODEL;
    const emit = options.onEvent ?? (() => undefined);
    const messages: ChatMessage[] = [
      { role: "system", content: options.systemPrompt ?? DEFAULT_SYSTEM },
      ...(options.history ?? []),
      { role: "user", content: options.userMessage },
    ];

    let usage = ZERO;
    let steps = 0;
    let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      if (options.signal?.aborted) {
        emit({ type: "done", message: "aborted", usage });
        return { messages, finalText, steps, usage, aborted: true, hitStepLimit: false };
      }

      emit({
        type: "status",
        message: `Working… turn ${step + 1} (limit ${maxSteps})`,
      });

      const tools =
        options.enabledTools && options.enabledTools.length > 0
          ? AGENT_TOOLS.filter((t) => options.enabledTools!.includes(t.function.name))
          : AGENT_TOOLS;

      let result: ChatResult;
      try {
        result = await this.llm.chat({
          model: options.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          temperature: 0.2,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emit({ type: "error", message: msg });
        throw error;
      }

      usage = sumUsage(usage, result.usage);
      emit({ type: "usage", usage: result.usage, usageSource: "orchestrator" });
      steps += 1;

      if (result.toolCalls.length === 0) {
        finalText = result.content ?? "";
        messages.push({ role: "assistant", content: finalText });
        emit({ type: "assistant_delta", message: finalText });
        emit({ type: "done", usage });
        return { messages, finalText, steps, usage, aborted: false, hitStepLimit: false };
      }

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        if (options.signal?.aborted) {
          emit({ type: "done", message: "aborted", usage });
          return { messages, finalText, steps, usage, aborted: true, hitStepLimit: false };
        }

        const args = parseToolArguments(call.function.arguments);
        const allowed = await this.approve(
          call,
          args,
          approvalMode,
          options.approvalModel ?? workerModel,
          emit,
          options.signal,
          (u) => {
            usage = sumUsage(usage, u);
          },
        );
        if (!allowed) {
          const denied = { ok: false, error: "denied by user / policy" };
          emit({
            type: "tool_result",
            tool: call.function.name,
            args,
            result: denied,
            toolCallId: call.id,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(denied),
          });
          continue;
        }

        const toolResult = await this.executeTool(
          call,
          args,
          emit,
          workerModel,
          (u) => {
            usage = sumUsage(usage, u);
          },
          options.rag,
          options.connectors,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        });
      }
    }

    finalText =
      `Hit the step limit (${maxSteps} model turns). I can continue if you say “continue” — or narrow the task (e.g. one category page + parse_data + export_csv).`;
    messages.push({ role: "assistant", content: finalText });
    emit({ type: "done", message: finalText, usage });
    return { messages, finalText, steps, usage, aborted: false, hitStepLimit: true };
  }

  private async approve(
    call: ToolCall,
    args: Record<string, unknown>,
    mode: ApprovalMode,
    approvalModel: string,
    emit: (e: AgentEvent) => void,
    signal: AbortSignal | undefined,
    onUsage: (u: LlmUsage) => void,
  ): Promise<boolean> {
    if (!SENSITIVE_TOOLS.has(call.function.name)) return true;
    if (mode === "auto_all") return true;

    if (mode === "auto_llm") {
      try {
        const verdict = await this.llm.chat({
          model: approvalModel,
          messages: [
            {
              role: "system",
              content:
                "You are a safety gate for a browser agent. Reply ONLY yes or no. Approve routine browsing (open shop URLs, click nav/search, type search queries). Deny destructive/sensitive (delete, payments, password changes, email send, random downloads).",
            },
            {
              role: "user",
              content: `Tool: ${call.function.name}\nArgs: ${JSON.stringify(args)}`,
            },
          ],
          maxTokens: 4,
          temperature: 0,
        });
        onUsage(verdict.usage);
        emit({ type: "usage", usage: verdict.usage, usageSource: "approval" });
        const text = (verdict.content ?? "").trim().toLowerCase();
        return text.startsWith("y");
      } catch {
        // fall through to ask
      }
    }

    return await new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const onAbort = () => resolve(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      emit({
        type: "tool_approval",
        tool: call.function.name,
        args,
        toolCallId: call.id,
        message: `Allow ${call.function.name}?`,
        resolve: (allow) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(allow);
        },
      });
    });
  }

  private async executeTool(
    call: ToolCall,
    args: Record<string, unknown>,
    emit: (e: AgentEvent) => void,
    workerModel: string,
    onUsage: (u: LlmUsage) => void,
    rag?: RagStore,
    connectors?: ConnectorBundle,
  ): Promise<unknown> {
    const name = call.function.name;
    emit({ type: "tool_start", tool: name, args, toolCallId: call.id });

    try {
      let result: unknown;

      if (name === "list_tabs") {
        result = { tabs: await this.browser.listTabs() };
      } else if (name === "open_tab") {
        const url = String(args.url ?? "");
        result = await this.browser.openTab(url, true);
      } else if (name === "activate_tab") {
        result = await this.browser.activateTab(Number(args.tabId));
      } else if (name === "navigate") {
        result = await this.browser.navigate(String(args.url ?? ""));
      } else if (name === "go_back") {
        result = await this.browser.goBack();
      } else if (name === "close_tab") {
        result = await this.browser.closeTab(Number(args.tabId));
      } else if (name === "parse_data") {
        result = await this.parseData(args, workerModel, emit, onUsage);
      } else if (name === "rag_status") {
        if (!rag) result = { ok: false, error: "rag store unavailable" };
        else {
          const meta = await rag.getMeta();
          const handle = await rag.getHandle();
          result = {
            ok: true,
            granted: Boolean(handle),
            folderName: meta?.folderName ?? handle?.folderName ?? null,
            fileCount: meta?.fileCount ?? 0,
            chunkCount: meta?.chunkCount ?? 0,
            indexedAt: meta?.indexedAt ?? null,
            lastError: meta?.lastError ?? null,
          };
        }
      } else if (name === "rag_search") {
        if (!rag) result = { ok: false, error: "rag store unavailable" };
        else {
          const meta = await rag.getMeta();
          if (!meta?.chunkCount) {
            result = {
              ok: false,
              error: "No local RAG index — grant a folder in Setup/Settings and wait for indexing",
            };
          } else {
            const query = String(args.query ?? "");
            const limit = typeof args.limit === "number" ? args.limit : 8;
            const hits = await rag.search(query, limit);
            result = {
              ok: true,
              hits: hits.map((h) => ({
                path: h.path,
                score: Number(h.score.toFixed(3)),
                snippet: h.content.slice(0, 500),
              })),
            };
          }
        }
      } else if (name === "rag_read_file") {
        if (!rag) result = { ok: false, error: "rag store unavailable" };
        else {
          const path = String(args.path ?? "");
          const maxChars = typeof args.maxChars === "number" ? args.maxChars : 12_000;
          const file = await rag.readPath(path, maxChars);
          result = file
            ? { ok: true, ...file }
            : { ok: false, error: `path not in index: ${path}` };
        }
      } else if (name === "ideaforge_search") {
        const cfg = connectors?.ideaforge;
        if (!cfg?.email || !cfg?.password) {
          result = {
            ok: false,
            error: "IdeaForge credentials missing — set email+password in Settings (vault)",
          };
        } else {
          result = await ideaforgeSearch(
            cfg,
            String(args.query ?? ""),
            typeof args.limit === "number" ? args.limit : 10,
          );
        }
      } else if (name === "github_search_code") {
        const cfg = connectors?.github;
        if (!cfg?.token) {
          result = { ok: false, error: "github_token missing in vault (Settings)" };
        } else {
          result = await githubSearchCode(cfg, String(args.query ?? ""), {
            repo: typeof args.repo === "string" ? args.repo : undefined,
            limit: typeof args.limit === "number" ? args.limit : 10,
          });
        }
      } else if (name === "github_get_file") {
        const cfg = connectors?.github;
        if (!cfg?.token) {
          result = { ok: false, error: "github_token missing in vault (Settings)" };
        } else {
          result = await githubGetFile(
            cfg,
            String(args.repo ?? ""),
            String(args.path ?? ""),
            typeof args.ref === "string" ? args.ref : undefined,
          );
        }
      } else if (name === "remember") {
        const text = String(args.text ?? "");
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        const entry = await this.memory.remember({ text, tags, kind: "note" });
        result = { saved: true, id: entry.id };
      } else if (name === "recall") {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 5;
        result = { hits: await this.memory.recall(query, limit) };
      } else if (name === "export_csv") {
        const filename = String(args.filename ?? "export.csv");
        const rows = Array.isArray(args.rows) ? (args.rows as string[][]) : [];
        const csv = rowsToCsv(rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)])));
        result = await this.browser.downloadText(
          filename.endsWith(".csv") ? filename : `${filename}.csv`,
          csv,
          "text/csv",
        );
      } else if (name === "save_bookmark") {
        result = await this.artifacts.saveBookmark({
          url: String(args.url ?? ""),
          title: String(args.title ?? ""),
          note: args.note != null ? String(args.note) : undefined,
        });
      } else if (name === "set_reminder") {
        result = await this.artifacts.setReminder({
          text: String(args.text ?? ""),
          atIso: String(args.atIso ?? ""),
        });
      } else if (name === "create_report") {
        const title = String(args.title ?? "Report");
        const bodyHtml = String(args.bodyHtml ?? "");
        const saved = await this.artifacts.saveReport({ title, bodyHtml });
        const html = buildReportHtml(title, bodyHtml);
        const dl = await this.browser.downloadText(
          `${title.replace(/[^\w.-]+/g, "_").slice(0, 40)}.html`,
          html,
          "text/html",
        );
        result = { ...saved, download: dl };
      } else if (name === "search_sessions") {
        if (!this.sessions) {
          result = { hits: [], error: "session store not available" };
        } else {
          const query = String(args.query ?? "");
          const limit = typeof args.limit === "number" ? args.limit : 8;
          const hits = await this.sessions.search(query, limit);
          result = {
            hits: hits.map((s) => ({
              id: s.id,
              title: s.title,
              updatedAt: s.updatedAt,
              preview: s.messages.find((m) => m.role === "user")?.content?.slice(0, 160),
            })),
          };
        }
      } else if (name === "save_site_profile") {
        result = await this.saveSiteProfile(args);
      } else if (name === "get_site_profile") {
        result = await this.getSiteProfile(args);
      } else if (name === "login") {
        result = await this.loginWithProfile(args, emit);
      } else if (name === "scrape_catalog") {
        result = await this.scrapeCatalog(args, workerModel, emit, onUsage);
      } else {
        const req = toolArgsToContentRequest(name, args);
        if (!req) {
          result = { ok: false, error: `invalid args for ${name}` };
        } else {
          result = await this.browser.runContent(req);
        }
      }

      emit({ type: "tool_result", tool: name, args, result, toolCallId: call.id });
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const result = { ok: false, error: msg };
      emit({ type: "tool_result", tool: name, args, result, toolCallId: call.id });
      return result;
    }
  }

  private async parseData(
    args: Record<string, unknown>,
    workerModel: string,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
  ): Promise<unknown> {
    const intent = String(args.intent ?? "");
    const schemaHint = args.schema_hint != null ? String(args.schema_hint) : "";
    let text = typeof args.text === "string" ? args.text : "";
    if (args.use_page || !text.trim()) {
      const page = await this.browser.runContent({ op: "get_page" });
      const data = page.data as { text?: string; title?: string; url?: string } | undefined;
      text = [data?.title, data?.url, data?.text].filter(Boolean).join("\n").slice(0, 14_000);
    }
    if (!text.trim()) return { ok: false, error: "no text to parse" };

    emit({ type: "status", message: `Worker parse (${workerModel})…` });
    const result = await this.llm.chat({
      model: workerModel,
      messages: [
        { role: "system", content: PARSE_SYSTEM },
        {
          role: "user",
          content: `Intent: ${intent}\nSchema hint: ${schemaHint || "(infer reasonable columns)"}\n\n--- PAGE TEXT ---\n${text}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 4096,
    });
    onUsage(result.usage);
    emit({ type: "usage", usage: result.usage, usageSource: "worker" });
    const parsed = parseJsonLoose(result.content ?? "{}");
    return { ok: true, model: workerModel, data: parsed };
  }

  private async saveSiteProfile(args: Record<string, unknown>): Promise<unknown> {
    if (!this.profiles) return { ok: false, error: "profile store not available" };
    const profile: SiteProfile = {
      name: String(args.name ?? ""),
      loginUrl: strOpt(args.loginUrl),
      username: strOpt(args.username),
      password: strOpt(args.password),
      usernameSelector: strOpt(args.usernameSelector),
      passwordSelector: strOpt(args.passwordSelector),
      submitSelector: strOpt(args.submitSelector),
      selector: strOpt(args.selector),
      nextSelector: strOpt(args.nextSelector),
      nextText: strOpt(args.nextText),
      intent: strOpt(args.intent),
      schemaHint: strOpt(args.schemaHint ?? args.schema_hint),
    };
    if (!profile.name) return { ok: false, error: "profile name required" };
    await this.profiles.save(profile);
    return { ok: true, saved: true, name: profile.name };
  }

  private async getSiteProfile(args: Record<string, unknown>): Promise<unknown> {
    if (!this.profiles) return { ok: false, error: "profile store not available" };
    const name = String(args.name ?? "");
    if (!name) return { ok: false, error: "profile name required" };
    const profile = await this.profiles.get(name);
    if (!profile) return { ok: false, error: `no profile '${name}'` };
    return { ok: true, profile };
  }

  private async loginWithProfile(
    args: Record<string, unknown>,
    emit: (e: AgentEvent) => void,
  ): Promise<unknown> {
    if (!this.profiles) return { ok: false, error: "profile store not available" };
    const profileName = strOpt(args.profile);
    let profile: SiteProfile | null = null;
    if (profileName) profile = await this.profiles.get(profileName);
    // inline overrides win
    const username = strOpt(args.username) ?? profile?.username ?? "";
    const password = strOpt(args.password) ?? profile?.password ?? "";
    const uSel = strOpt(args.usernameSelector) ?? profile?.usernameSelector ?? "";
    const pSel = strOpt(args.passwordSelector) ?? profile?.passwordSelector ?? "";
    const submit = strOpt(args.submitSelector) ?? profile?.submitSelector ?? "";
    const loginUrl = strOpt(args.loginUrl) ?? profile?.loginUrl ?? "";
    if (!username || !password || !uSel || !pSel) {
      return { ok: false, error: "login needs username+password+usernameSelector+passwordSelector (or a profile that has them)" };
    }
    if (loginUrl) {
      emit({ type: "status", message: `Login: navigate ${loginUrl}` });
      await this.browser.navigate(loginUrl);
      await wait(800);
    }
    emit({ type: "status", message: "Login: filling credentials" });
    await this.browser.runContent({ op: "type_text", selector: uSel, text: username, submit: false });
    await this.browser.runContent({ op: "type_text", selector: pSel, text: password, submit: false });
    if (submit) {
      const clicked = await this.browser.runContent({ op: "click", selector: submit });
      if (!clicked.ok) return { ok: false, error: `submit selector not found: ${submit}` };
    }
    await wait(1200);
    return { ok: true, logged_in: true, profile: profileName ?? "(inline)" };
  }

  private async scrapeCatalog(
    args: Record<string, unknown>,
    workerModel: string,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
  ): Promise<unknown> {
    const profileName = strOpt(args.profile);
    let profile: SiteProfile | null = null;
    if (profileName && this.profiles) profile = await this.profiles.get(profileName);

    const selector = strOpt(args.selector) ?? profile?.selector ?? "";
    const intent = strOpt(args.intent) ?? profile?.intent ?? "";
    const nextSelector = strOpt(args.nextSelector) ?? profile?.nextSelector ?? "";
    const nextText = strOpt(args.nextText) ?? profile?.nextText ?? "";
    const schemaHint = strOpt(args.schemaHint ?? args.schema_hint) ?? profile?.schemaHint ?? "";
    const maxPages = clampInt(args.maxPages, 20, 1, 100);

    if (!selector || !intent) {
      return { ok: false, error: "scrape_catalog needs selector + intent (or a profile that has them)" };
    }

    const allRows: unknown[] = [];
    const seen = new Set<string>();
    let pages = 0;
    const notes: string[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const items = await this.browser.runContent({ op: "query_all", selector, attributes: [] });
      if (!items.ok) {
        notes.push(`page ${page + 1}: query_all failed: ${items.error ?? "?"}`);
        break;
      }
      const values = (items.data as { values?: string[] } | undefined)?.values ?? [];
      if (values.length === 0 && page === 0) {
        notes.push("no items matched selector on first page");
        break;
      }
      emit({ type: "status", message: `Scrape page ${page + 1}: ${values.length} items` });
      const text = values.join("\n---\n").slice(0, 14_000);
      const parsed = await this.parseData({ intent, schema_hint: schemaHint, text }, workerModel, emit, onUsage);
      const data = (parsed as { data?: { rows?: unknown[]; notes?: string } } | undefined)?.data;
      const rows = Array.isArray(data?.rows) ? data!.rows! : [];
      for (const row of rows) {
        const sig = JSON.stringify(row);
        if (!seen.has(sig)) {
          seen.add(sig);
          allRows.push(row);
        }
      }
      pages += 1;
      if (values.length === 0) break;

      // advance to next page
      let advanced = false;
      if (nextSelector) {
        const click = await this.browser.runContent({ op: "click", selector: nextSelector });
        advanced = click.ok;
      } else if (nextText) {
        const found = await this.browser.runContent({ op: "find_text", text: nextText, scrollIntoView: true });
        const hits = (found.data as { matches?: Array<{ selector?: string }> } | undefined)?.matches ?? [];
        const sel = hits[0]?.selector;
        if (sel) {
          const click = await this.browser.runContent({ op: "click", selector: sel });
          advanced = click.ok;
        }
      }
      if (!advanced) {
        notes.push("no next page — stopped");
        break;
      }
      await wait(900);
    }

    return { ok: true, pages, count: allRows.length, rows: allRows, notes: notes.join("; ") || undefined };
  }
}
