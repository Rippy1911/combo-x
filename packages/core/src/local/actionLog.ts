/**
 * Durable AI action log — every tool call with approval + page metadata.
 * Plaintext IDB (same class as sessions). Args/results are redacted before write.
 */

import { redactSensitiveDeep, redactSensitiveFields } from "./views.js";

export type ActionApprovalDecision =
  | "allowed"
  | "denied"
  | "auto_all"
  | "auto_llm"
  | "n/a";

export interface ActionLogEntry {
  id: string;
  /** ISO timestamp when the tool finished (or was denied) */
  at: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  tool: string;
  args: Record<string, unknown>;
  /** Short result summary (truncated JSON) */
  resultSummary: string;
  ok: boolean;
  approvalDecision: ActionApprovalDecision;
  approvalMode: string;
  pageUrl?: string;
  pageTitle?: string;
  tabId?: number;
  /** Target URL from args when tool navigates/opens */
  targetUrl?: string;
  error?: string;
}

const DB_NAME = "combo_x_action_log";
const STORE = "actions";
const DB_VERSION = 1;
const MAX_ENTRIES = 2000;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("at", "at", { unique: false });
        os.createIndex("sessionId", "sessionId", { unique: false });
        os.createIndex("tool", "tool", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("action log db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export function summarizeResult(result: unknown, max = 400): string {
  if (result == null) return "";
  try {
    const safe = redactSensitiveDeep(result);
    const s = typeof safe === "string" ? safe : JSON.stringify(safe);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(result).slice(0, max);
  }
}

/** Redact typed secrets (password fields) before logging tool args. */
export function redactToolArgs(
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const base = redactSensitiveFields({ ...args });
  if (
    (tool === "type_index" || tool === "type_text") &&
    typeof base.text === "string" &&
    /password|passwd|secret|credential/i.test(String(base.selector ?? ""))
  ) {
    base.text = "[redacted]";
  }
  return base;
}

export function extractTargetUrl(args: Record<string, unknown>): string | undefined {
  for (const key of ["url", "loginUrl", "href"]) {
    const v = args[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return undefined;
}

export function resultOk(result: unknown): boolean {
  if (result == null) return true;
  if (typeof result === "object" && result && "ok" in result) {
    return Boolean((result as { ok: unknown }).ok);
  }
  if (typeof result === "object" && result && "error" in result) {
    return !(result as { error?: unknown }).error;
  }
  return true;
}

export function resultError(result: unknown): string | undefined {
  if (typeof result === "object" && result && "error" in result) {
    const e = (result as { error?: unknown }).error;
    return e != null ? String(e) : undefined;
  }
  return undefined;
}

/** Map approval mode + allow flag → decision for the log. */
export function approvalDecisionFor(
  mode: string,
  allowed: boolean,
  wasSensitive: boolean,
): ActionApprovalDecision {
  if (!wasSensitive) return "n/a";
  if (!allowed) return "denied";
  if (mode === "auto_all") return "auto_all";
  if (mode === "auto_llm") return "auto_llm";
  return "allowed";
}

export class ActionLogStore {
  constructor(private readonly dbName = DB_NAME) {}

  async append(
    input: Omit<ActionLogEntry, "id" | "at"> & { id?: string; at?: string },
  ): Promise<ActionLogEntry> {
    const entry: ActionLogEntry = {
      id: input.id ?? crypto.randomUUID(),
      at: input.at ?? new Date().toISOString(),
      sessionId: input.sessionId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      tool: input.tool,
      args: redactToolArgs(input.tool, { ...input.args }),
      resultSummary: summarizeResult(
        (() => {
          try {
            return JSON.parse(input.resultSummary);
          } catch {
            return input.resultSummary;
          }
        })(),
      ),
      ok: input.ok,
      approvalDecision: input.approvalDecision,
      approvalMode: input.approvalMode,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      tabId: input.tabId,
      targetUrl: input.targetUrl,
      error: input.error,
    };
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(entry));
      await this.trim(db);
      return entry;
    } finally {
      db.close();
    }
  }

  private async trim(db: IDBDatabase): Promise<void> {
    const all = await idbReq<ActionLogEntry[]>(
      db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
    );
    if (all.length <= MAX_ENTRIES) return;
    const sorted = all.sort((a, b) => a.at.localeCompare(b.at));
    const drop = sorted.slice(0, all.length - MAX_ENTRIES);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const e of drop) store.delete(e.id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async list(limit = 100, opts?: { sessionId?: string; tool?: string }): Promise<ActionLogEntry[]> {
    const db = await openDb(this.dbName);
    try {
      let all = await idbReq<ActionLogEntry[]>(
        db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
      );
      if (opts?.sessionId) all = all.filter((e) => e.sessionId === opts.sessionId);
      if (opts?.tool) all = all.filter((e) => e.tool === opts.tool);
      return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).clear());
    } finally {
      db.close();
    }
  }

  async exportJson(limit = 500): Promise<string> {
    const rows = await this.list(limit);
    return JSON.stringify(rows, null, 2);
  }
}
