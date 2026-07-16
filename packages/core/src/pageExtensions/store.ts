/**
 * Page extension registry + isolated data + audit.
 * DB: combo_x_page_ext — NEVER shares stores with sessions/vault/views.
 */

import { sha256Hex } from "./hash.js";
import type {
  PageExtAuditAction,
  PageExtAuditEntry,
  PageExtBridgeSpec,
  PageExtDataRow,
  PageExtension,
} from "./types.js";
import { urlMatches } from "./match.js";

const DB_NAME = "combo_x_page_ext";
const DB_VERSION = 1;
const EXT_STORE = "extensions";
const DATA_STORE = "data";
const AUDIT_STORE = "audit";
const MAX_AUDIT = 5000;
const MAX_SOURCE = 200_000;

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EXT_STORE)) {
        const os = db.createObjectStore(EXT_STORE, { keyPath: "id" });
        os.createIndex("enabled", "enabled", { unique: false });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        const os = db.createObjectStore(DATA_STORE, { keyPath: "id" });
        os.createIndex("extensionId", "extensionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(AUDIT_STORE)) {
        const os = db.createObjectStore(AUDIT_STORE, { keyPath: "id" });
        os.createIndex("at", "at", { unique: false });
        os.createIndex("extensionId", "extensionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("page_ext db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

function dataKey(extensionId: string, key: string): string {
  return `${extensionId}::${key}`;
}

export class PageExtensionStore {
  private db: IDBDatabase | null = null;

  constructor(private readonly dbName = DB_NAME) {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }

  private store(name: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction(name, mode).objectStore(name);
  }

  async audit(input: {
    extensionId: string;
    action: PageExtAuditAction;
    actor: PageExtAuditEntry["actor"];
    sessionId?: string;
    runId?: string;
    pageUrl?: string;
    tabId?: number;
    detail?: Record<string, unknown>;
  }): Promise<PageExtAuditEntry> {
    const entry: PageExtAuditEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      extensionId: input.extensionId,
      action: input.action,
      actor: input.actor,
      sessionId: input.sessionId,
      runId: input.runId,
      pageUrl: input.pageUrl,
      tabId: input.tabId,
      detail: input.detail,
    };
    await this.getDb();
    await idbReq(this.store(AUDIT_STORE, "readwrite").put(entry));
    const all = await idbReq<PageExtAuditEntry[]>(this.store(AUDIT_STORE, "readonly").getAll());
    if (all.length > MAX_AUDIT) {
      all.sort((a, b) => a.at.localeCompare(b.at));
      const drop = all.slice(0, all.length - MAX_AUDIT);
      const tx = this.db!.transaction(AUDIT_STORE, "readwrite");
      for (const d of drop) tx.objectStore(AUDIT_STORE).delete(d.id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("audit trim failed"));
      });
    }
    return entry;
  }

  async listAudit(extensionId?: string, limit = 100): Promise<PageExtAuditEntry[]> {
    await this.getDb();
    const all = await idbReq<PageExtAuditEntry[]>(this.store(AUDIT_STORE, "readonly").getAll());
    const filtered = extensionId ? all.filter((e) => e.extensionId === extensionId) : all;
    return filtered.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  async list(): Promise<PageExtension[]> {
    await this.getDb();
    const all = await idbReq<PageExtension[]>(this.store(EXT_STORE, "readonly").getAll());
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<PageExtension | null> {
    await this.getDb();
    return (await idbReq<PageExtension | undefined>(this.store(EXT_STORE, "readonly").get(id))) ?? null;
  }

  async create(input: {
    name: string;
    source: string;
    patterns: string[];
    description?: string;
    runAt?: PageExtension["runAt"];
    createdBy?: "agent" | "user";
    sessionId?: string;
    enabled?: boolean;
  }): Promise<PageExtension> {
    if (!input.source.trim()) throw new Error("source required");
    if (input.source.length > MAX_SOURCE) throw new Error(`source exceeds ${MAX_SOURCE} chars`);
    if (!input.patterns.length) throw new Error("at least one match pattern required");
    const now = new Date().toISOString();
    const row: PageExtension = {
      id: crypto.randomUUID(),
      name: input.name.trim() || "Untitled extension",
      description: input.description?.trim(),
      source: input.source,
      match: { patterns: input.patterns.map((p) => p.trim()).filter(Boolean) },
      enabled: input.enabled ?? false,
      runAt: input.runAt ?? "document_idle",
      world: "MAIN",
      approval: "draft",
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy ?? "agent",
      createdInSessionId: input.sessionId,
      bridge: null,
      sourceHash: await sha256Hex(input.source),
    };
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").put(row));
    await this.audit({
      extensionId: row.id,
      action: "create",
      actor: row.createdBy,
      sessionId: input.sessionId,
      detail: { name: row.name, patterns: row.match.patterns, sourceHash: row.sourceHash },
    });
    return row;
  }

  async update(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      source: string;
      patterns: string[];
      runAt: PageExtension["runAt"];
      enabled: boolean;
    }>,
    meta?: { actor?: "agent" | "user"; sessionId?: string },
  ): Promise<PageExtension> {
    const cur = await this.get(id);
    if (!cur) throw new Error("extension not found");
    if (patch.source != null && patch.source.length > MAX_SOURCE) {
      throw new Error(`source exceeds ${MAX_SOURCE} chars`);
    }
    const sourceChanged = patch.source != null && patch.source !== cur.source;
    const next: PageExtension = {
      ...cur,
      name: patch.name?.trim() || cur.name,
      description: patch.description !== undefined ? patch.description.trim() : cur.description,
      source: patch.source ?? cur.source,
      match: patch.patterns
        ? { patterns: patch.patterns.map((p) => p.trim()).filter(Boolean) }
        : cur.match,
      runAt: patch.runAt ?? cur.runAt,
      enabled: patch.enabled ?? cur.enabled,
      version: sourceChanged ? cur.version + 1 : cur.version,
      updatedAt: new Date().toISOString(),
      sourceHash: patch.source != null ? await sha256Hex(patch.source) : cur.sourceHash,
      // Source change reverts approval
      approval: sourceChanged ? "draft" : cur.approval,
      approvedAt: sourceChanged ? undefined : cur.approvedAt,
      approvedBy: sourceChanged ? undefined : cur.approvedBy,
    };
    if (!next.match.patterns.length) throw new Error("at least one match pattern required");
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").put(next));
    await this.audit({
      extensionId: id,
      action: "update",
      actor: meta?.actor ?? "agent",
      sessionId: meta?.sessionId,
      detail: {
        sourceChanged,
        version: next.version,
        enabled: next.enabled,
        approval: next.approval,
        sourceHash: next.sourceHash,
      },
    });
    if (patch.enabled === true && !cur.enabled) {
      await this.audit({
        extensionId: id,
        action: "enable",
        actor: meta?.actor ?? "agent",
        sessionId: meta?.sessionId,
      });
    }
    if (patch.enabled === false && cur.enabled) {
      await this.audit({
        extensionId: id,
        action: "disable",
        actor: meta?.actor ?? "agent",
        sessionId: meta?.sessionId,
      });
    }
    return next;
  }

  async approve(id: string, actor: "user" | "agent" = "user", sessionId?: string): Promise<PageExtension> {
    const cur = await this.get(id);
    if (!cur) throw new Error("extension not found");
    const next: PageExtension = {
      ...cur,
      approval: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: actor,
      updatedAt: new Date().toISOString(),
      sourceHash: await sha256Hex(cur.source),
    };
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").put(next));
    await this.audit({
      extensionId: id,
      action: "approve",
      actor,
      sessionId,
      detail: { sourceHash: next.sourceHash, version: next.version },
    });
    return next;
  }

  async revoke(id: string, actor: "user" | "agent" = "user", sessionId?: string): Promise<PageExtension> {
    const cur = await this.get(id);
    if (!cur) throw new Error("extension not found");
    const next: PageExtension = {
      ...cur,
      approval: "revoked",
      enabled: false,
      updatedAt: new Date().toISOString(),
    };
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").put(next));
    await this.audit({
      extensionId: id,
      action: "revoke",
      actor,
      sessionId,
    });
    return next;
  }

  async setBridge(
    id: string,
    bridge: PageExtBridgeSpec | null,
    meta?: { actor?: "agent" | "user"; sessionId?: string },
  ): Promise<PageExtension> {
    const cur = await this.get(id);
    if (!cur) throw new Error("extension not found");
    const next: PageExtension = {
      ...cur,
      bridge,
      updatedAt: new Date().toISOString(),
    };
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").put(next));
    await this.audit({
      extensionId: id,
      action: bridge ? "bridge_set" : "bridge_clear",
      actor: meta?.actor ?? "agent",
      sessionId: meta?.sessionId,
      detail: bridge
        ? {
            exportChannels: bridge.exportChannels,
            allowStorage: !!bridge.allowStorage,
            maxPayloadBytes: bridge.maxPayloadBytes ?? 64_000,
          }
        : { cleared: true },
    });
    return next;
  }

  async remove(id: string, actor: "agent" | "user" = "user", sessionId?: string): Promise<boolean> {
    const cur = await this.get(id);
    if (!cur) return false;
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").delete(id));
    // Wipe isolated data for this extension
    const rows = await idbReq<PageExtDataRow[]>(this.store(DATA_STORE, "readonly").getAll());
    const tx = this.db!.transaction(DATA_STORE, "readwrite");
    for (const r of rows.filter((x) => x.extensionId === id)) {
      tx.objectStore(DATA_STORE).delete(r.id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("data wipe failed"));
    });
    await this.audit({
      extensionId: id,
      action: "delete",
      actor,
      sessionId,
      detail: { name: cur.name },
    });
    return true;
  }

  async markInjected(id: string, pageUrl: string, tabId?: number): Promise<void> {
    const cur = await this.get(id);
    if (!cur) return;
    const next: PageExtension = {
      ...cur,
      lastInjectedAt: new Date().toISOString(),
      lastInjectedUrl: pageUrl,
      updatedAt: cur.updatedAt,
    };
    await this.getDb();
    await idbReq(this.store(EXT_STORE, "readwrite").put(next));
    await this.audit({
      extensionId: id,
      action: "inject",
      actor: "system",
      pageUrl,
      tabId,
      detail: { version: cur.version, sourceHash: cur.sourceHash },
    });
  }

  /** Enabled + approved extensions matching URL. */
  async listInjectableForUrl(url: string): Promise<PageExtension[]> {
    const all = await this.list();
    return all.filter(
      (e) => e.enabled && e.approval === "approved" && urlMatches(url, e.match),
    );
  }

  // --- Isolated data plane (not combo sessions/vault) ---

  async dataSet(
    extensionId: string,
    key: string,
    value: unknown,
    meta?: { actor?: PageExtAuditEntry["actor"]; pageUrl?: string; tabId?: number },
  ): Promise<PageExtDataRow> {
    if (!key.trim()) throw new Error("key required");
    const row: PageExtDataRow = {
      id: dataKey(extensionId, key),
      extensionId,
      key,
      value,
      updatedAt: new Date().toISOString(),
    };
    await this.getDb();
    await idbReq(this.store(DATA_STORE, "readwrite").put(row));
    await this.audit({
      extensionId,
      action: "storage_set",
      actor: meta?.actor ?? "page",
      pageUrl: meta?.pageUrl,
      tabId: meta?.tabId,
      detail: { key },
    });
    return row;
  }

  async dataGet(extensionId: string, key: string): Promise<unknown | undefined> {
    await this.getDb();
    const row = await idbReq<PageExtDataRow | undefined>(
      this.store(DATA_STORE, "readonly").get(dataKey(extensionId, key)),
    );
    return row?.value;
  }

  async dataList(extensionId: string): Promise<Array<{ key: string; updatedAt: string }>> {
    await this.getDb();
    const all = await idbReq<PageExtDataRow[]>(this.store(DATA_STORE, "readonly").getAll());
    return all
      .filter((r) => r.extensionId === extensionId)
      .map((r) => ({ key: r.key, updatedAt: r.updatedAt }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async dataGetAll(extensionId: string): Promise<Record<string, unknown>> {
    await this.getDb();
    const all = await idbReq<PageExtDataRow[]>(this.store(DATA_STORE, "readonly").getAll());
    const out: Record<string, unknown> = {};
    for (const r of all.filter((x) => x.extensionId === extensionId)) {
      out[r.key] = r.value;
    }
    return out;
  }

  async dataDelete(
    extensionId: string,
    key: string,
    meta?: { actor?: PageExtAuditEntry["actor"]; pageUrl?: string; tabId?: number },
  ): Promise<boolean> {
    await this.getDb();
    const id = dataKey(extensionId, key);
    const existing = await idbReq<PageExtDataRow | undefined>(
      this.store(DATA_STORE, "readonly").get(id),
    );
    if (!existing) return false;
    await idbReq(this.store(DATA_STORE, "readwrite").delete(id));
    await this.audit({
      extensionId,
      action: "storage_delete",
      actor: meta?.actor ?? "page",
      pageUrl: meta?.pageUrl,
      tabId: meta?.tabId,
      detail: { key },
    });
    return true;
  }

  async dataClear(extensionId: string, sessionId?: string): Promise<number> {
    await this.getDb();
    const all = await idbReq<PageExtDataRow[]>(this.store(DATA_STORE, "readonly").getAll());
    const mine = all.filter((r) => r.extensionId === extensionId);
    const tx = this.db!.transaction(DATA_STORE, "readwrite");
    for (const r of mine) tx.objectStore(DATA_STORE).delete(r.id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("data clear failed"));
    });
    await this.audit({
      extensionId,
      action: "data_clear",
      actor: "agent",
      sessionId,
      detail: { count: mine.length },
    });
    return mine.length;
  }

  async recordExport(
    extensionId: string,
    channel: string,
    pageUrl?: string,
    tabId?: number,
  ): Promise<void> {
    await this.audit({
      extensionId,
      action: "export",
      actor: "page",
      pageUrl,
      tabId,
      detail: { channel },
    });
  }
}
