/**
 * Persisted chat sessions (IndexedDB). Searchable by title + message text.
 */

/** Inline chat artifact snapshot (screenshots / HTML previews) in the turn timeline. */
export type SessionArtifactPayload = {
  kind: "table" | "html" | "text" | "image" | "compare";
  title: string;
  headers?: string[];
  rows?: string[][];
  html?: string;
  text?: string;
  src?: string;
  beforeSrc?: string;
  afterSrc?: string;
  attachmentId?: string;
  beforeAttachmentId?: string;
  afterAttachmentId?: string;
  interactive?: boolean;
};

/** Timeline blocks for assistant turns (reasoning / thoughts / tools / artifacts / final message). */
export type SessionTurnBlock =
  | { id: string; kind: "reasoning"; text: string }
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "message"; text: string }
  | { id: string; kind: "tools"; toolIds: string[] }
  | { id: string; kind: "artifact"; artifact: SessionArtifactPayload };

/** Snapshot of what was injected for a user turn (Context button). */
export interface SessionRunContext {
  systemPrompt: string;
  memoryBlock: string;
  taskBlock: string;
  skillBlock: string;
  toolCatalogBlock: string;
  /** User turn payload (tab + picks + message) as sent to the LLM. */
  userPreview?: string;
  toolNames: string[];
  model: string;
  transport: "stream" | "full";
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  /** Operator starred this turn for later reference */
  bookmarked?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  /** Expandable tool chips attached to this turn */
  tools?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "running" | "done" | "denied" | "error";
  }>;
  /** Interleaved UI timeline (optional; content remains the SoT for LLM history). */
  blocks?: SessionTurnBlock[];
  /** User turns only — system/memories/tasks/skills/tool index for Context inspect. */
  runContext?: SessionRunContext;
  /** User turns — element picker refs (JSON-safe). */
  picks?: Array<Record<string, unknown>>;
  /** User turns — active tab snapshot at send. */
  activeTab?: { tabId?: number; url?: string; title?: string; at: string };
}

const RUN_CONTEXT_FIELD_MAX = 24_000;

/** Cap huge catalog blocks so IDB saves stay reliable. */
export function slimRunContextForStorage(ctx: SessionRunContext): SessionRunContext {
  const trim = (s: string) =>
    s.length > RUN_CONTEXT_FIELD_MAX
      ? `${s.slice(0, RUN_CONTEXT_FIELD_MAX)}\n…(truncated for storage)`
      : s;
  return {
    ...ctx,
    systemPrompt: trim(ctx.systemPrompt),
    memoryBlock: trim(ctx.memoryBlock),
    taskBlock: trim(ctx.taskBlock),
    skillBlock: trim(ctx.skillBlock),
    toolCatalogBlock: trim(ctx.toolCatalogBlock),
    userPreview: ctx.userPreview ? trim(ctx.userPreview) : ctx.userPreview,
    toolNames: ctx.toolNames.slice(0, 200),
  };
}

/** JSON-clone + size-cap so IDB structured-clone never rejects a session put. */
export function cloneJsonSafe(value: unknown, maxChars = 8000): unknown {
  try {
    const s = JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return String(v);
      if (typeof v === "function" || typeof v === "symbol") return undefined;
      return v;
    });
    if (s === undefined) return undefined;
    if (s.length <= maxChars) return JSON.parse(s) as unknown;
    return { _truncated: true, preview: `${s.slice(0, maxChars)}…` };
  } catch {
    return { _unserializable: true, preview: String(value).slice(0, maxChars) };
  }
}

export function sanitizeSessionTools(
  tools?: SessionMessage["tools"],
): SessionMessage["tools"] {
  if (!tools?.length) return tools;
  return tools.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    args: (cloneJsonSafe(t.args ?? {}, 4000) as Record<string, unknown>) ?? {},
    result: t.result === undefined ? undefined : cloneJsonSafe(t.result, 8000),
  }));
}

/** Drop megabase64 from artifact blocks; keep attachmentId so reload can rehydrate. */
export function sanitizeSessionBlocks(
  blocks?: SessionTurnBlock[],
): SessionTurnBlock[] | undefined {
  if (!blocks?.length) return blocks;
  return blocks.map((b) => {
    if (b.kind !== "artifact") return b;
    const a = { ...b.artifact };
    const dropData = (v?: string) =>
      v && v.startsWith("data:") && v.length > 400 ? undefined : v;
    if (a.attachmentId) a.src = dropData(a.src);
    else if (a.src && a.src.startsWith("data:") && a.src.length > 12_000) {
      a.src = `${a.src.slice(0, 80)}…`;
    }
    if (a.beforeAttachmentId) a.beforeSrc = dropData(a.beforeSrc);
    if (a.afterAttachmentId) a.afterSrc = dropData(a.afterSrc);
    if (a.html && a.html.length > 80_000) {
      a.html = `${a.html.slice(0, 80_000)}\n…(truncated for storage)`;
    }
    return { ...b, artifact: a };
  });
}

function sessionHaystack(s: ChatSession): string {
  const parts = [s.title];
  for (const m of s.messages) {
    parts.push(m.content);
    if (m.blocks) {
      for (const b of m.blocks) {
        if (b.kind === "tools") continue;
        if (b.kind === "artifact") {
          parts.push(b.artifact.title);
          continue;
        }
        parts.push(b.text);
      }
    }
    if (m.tools) {
      for (const t of m.tools) {
        parts.push(t.name);
        try {
          parts.push(JSON.stringify(t.args ?? {}).slice(0, 400));
        } catch {
          /* ignore */
        }
      }
    }
  }
  return parts.join(" ").slice(0, 40_000);
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  totalTokens: number;
  estimatedCostUsd: number;
  /** Operator starred this conversation */
  bookmarked?: boolean;
  /** Pin DOM/navigate tools to this browser tab (no activate_tab). */
  boundTabId?: number;
}

/** Strip megabase64 so exports stay small; keep attachment ids. */
function stripDataUrlsDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (typeof value === "string") {
    if (value.startsWith("data:") && value.length > 200) {
      return `data:…[omitted ${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => stripDataUrlsDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripDataUrlsDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type SessionExportFormat = "json" | "md";

/** Full conversation dump for download / publish (no megabase64). */
export function formatSessionExport(
  session: ChatSession,
  format: SessionExportFormat = "json",
): { filename: string; mime: string; body: string } {
  const safeTitle = (session.title || "chat")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 48);
  const stamp = session.updatedAt.slice(0, 10);

  const messages = session.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    bookmarked: m.bookmarked,
    picks: m.picks,
    activeTab: m.activeTab,
    runContext: m.runContext
      ? {
          model: m.runContext.model,
          transport: m.runContext.transport,
          toolNames: m.runContext.toolNames,
          userPreview: m.runContext.userPreview,
          // Full blocks available via get_session / Context UI — keep export lean but complete enough
          systemPrompt: m.runContext.systemPrompt,
          memoryBlock: m.runContext.memoryBlock,
          taskBlock: m.runContext.taskBlock,
          skillBlock: m.runContext.skillBlock,
          toolCatalogBlock: m.runContext.toolCatalogBlock,
        }
      : undefined,
    tools: m.tools?.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      args: stripDataUrlsDeep(t.args),
      result: stripDataUrlsDeep(t.result),
    })),
    blocks: m.blocks
      ? stripDataUrlsDeep(
          m.blocks.map((b) => {
            if (b.kind === "artifact") {
              const a = { ...b.artifact };
              if (a.src?.startsWith("data:")) a.src = a.attachmentId
                ? `attachment:${a.attachmentId}`
                : "data:…[omitted]";
              if (a.beforeSrc?.startsWith("data:")) {
                a.beforeSrc = a.beforeAttachmentId
                  ? `attachment:${a.beforeAttachmentId}`
                  : "data:…[omitted]";
              }
              if (a.afterSrc?.startsWith("data:")) {
                a.afterSrc = a.afterAttachmentId
                  ? `attachment:${a.afterAttachmentId}`
                  : "data:…[omitted]";
              }
              return { ...b, artifact: a };
            }
            return b;
          }),
        )
      : undefined,
  }));

  if (format === "md") {
    const lines: string[] = [
      `# ${session.title || "Untitled"}`,
      "",
      `- id: \`${session.id}\``,
      `- updated: ${session.updatedAt}`,
      `- boundTabId: ${session.boundTabId ?? "(none)"}`,
      `- tokens: ${session.totalTokens}`,
      "",
      "---",
      "",
    ];
    for (const m of messages) {
      lines.push(`## ${m.role} · ${m.createdAt}`);
      lines.push("");
      lines.push(m.content || "_(empty)_");
      lines.push("");
      if (m.tools?.length) {
        lines.push("### Tools");
        for (const t of m.tools) {
          lines.push(`- **${t.name}** (${t.status})`);
          lines.push("```json");
          lines.push(JSON.stringify({ args: t.args, result: t.result }, null, 2).slice(0, 12_000));
          lines.push("```");
        }
        lines.push("");
      }
      if (m.picks?.length) {
        lines.push("### Picks");
        lines.push("```json");
        lines.push(JSON.stringify(m.picks, null, 2));
        lines.push("```");
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
    lines.push(
      "_Endpoint note: Combo-X is MV3 local-first. The public URL (if published) + `get_session` / `export_session` are how agents re-read this transcript._",
    );
    return {
      filename: `combo-x-${safeTitle}-${stamp}.md`,
      mime: "text/markdown;charset=utf-8",
      body: lines.join("\n"),
    };
  }

  const payload = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    bookmarked: !!session.bookmarked,
    boundTabId: session.boundTabId ?? null,
    totalTokens: session.totalTokens,
    estimatedCostUsd: session.estimatedCostUsd,
    messages,
    note: "Images referenced by attachmentId — no megabase64. Publish via publish_upload for a public URL.",
  };
  return {
    filename: `combo-x-${safeTitle}-${stamp}.json`,
    mime: "application/json;charset=utf-8",
    body: JSON.stringify(payload, null, 2),
  };
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("sessions db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export class SessionStore {
  private db: IDBDatabase | null = null;
  constructor(private readonly dbName = "combo_x_sessions") {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction("sessions", mode).objectStore("sessions");
  }

  async create(title = "New chat"): Promise<ChatSession> {
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
    await this.getDb();
    await idbReq(this.store("readwrite").put(session));
    return session;
  }

  async get(id: string): Promise<ChatSession | null> {
    await this.getDb();
    return (await idbReq<ChatSession | undefined>(this.store("readonly").get(id))) ?? null;
  }

  async save(session: ChatSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    // Always persist clone-safe tools so huge scrape results cannot wipe history.
    session.messages = session.messages.map((m) => ({
      ...m,
      tools: sanitizeSessionTools(m.tools),
      blocks: sanitizeSessionBlocks(m.blocks),
    }));
    await this.getDb();
    try {
      await idbReq(this.store("readwrite").put(session));
    } catch (err) {
      // Last resort: drop tool bodies / blocks, keep text so the chat survives.
      const stripped: ChatSession = {
        ...session,
        messages: session.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          bookmarked: m.bookmarked,
          usage: m.usage,
          tools: m.tools?.map((t) => ({
            id: t.id,
            name: t.name,
            args: {},
            status: t.status,
            result: { _omitted: "persist_fallback" },
          })),
        })),
      };
      await idbReq(this.store("readwrite").put(stripped));
      console.warn("[SessionStore] save fell back to stripped tools", err);
    }
  }

  async list(limit = 50): Promise<ChatSession[]> {
    await this.getDb();
    const all = await idbReq<ChatSession[]>(this.store("readonly").getAll());
    return all
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  /**
   * Search sessions by keyword. Empty / whitespace query → recent list (same as list).
   * Matches title, message content, block text, and tool names (substring, any token).
   */
  async search(query: string, limit = 20): Promise<ChatSession[]> {
    const q = query.trim();
    const all = await this.list(200);
    if (!q) return all.slice(0, limit);
    const tokens = tokenize(q);
    const qLower = q.toLowerCase();
    return all
      .map((s) => {
        const hay = sessionHaystack(s);
        const hayLower = hay.toLowerCase();
        let score = 0;
        if (hayLower.includes(qLower)) score += 3;
        for (const t of tokens) {
          if (hayLower.includes(t)) score += 1;
        }
        // Recency tie-break so empty-ish scores still prefer fresh chats when equal.
        const recency = Date.parse(s.updatedAt) / 1e15;
        return { s, score: score + recency };
      })
      .filter((x) => x.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.s);
  }

  async delete(id: string): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").delete(id));
  }
}
