/** Agent profile presets — orchestrator model, tool allowlist, connector bindings. */

export type ToolAllowlist = string[] | "all";

export type AgentBudgetMode = "normal" | "budget";

export type ApprovalMode = "ask" | "auto_llm" | "auto_all";

export interface AgentProfile {
  id: string;
  name: string;
  systemPrompt?: string;
  orchestratorModel?: string;
  workerModel?: string;
  toolAllowlist: ToolAllowlist;
  connectorIds: string[];
  budgetMode?: AgentBudgetMode;
  approvalMode?: ApprovalMode;
  ragEnabled?: boolean;
  maxSteps?: number;
  canDelegate?: boolean;
  canSelfEdit?: boolean;
  nestingDepth?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedAgentProfile extends AgentProfile {
  maxSteps: number;
  canDelegate: boolean;
  canSelfEdit: boolean;
  nestingDepth: number;
}

const DEFAULT_MAX_STEPS = 32;
const DEFAULT_CAN_DELEGATE = true;
const DEFAULT_CAN_SELF_EDIT = true;
const DEFAULT_NESTING_DEPTH = 1;

/** Apply profile defaults for runtime agent loop / delegation. */
export function resolveAgentProfile(profile: AgentProfile): ResolvedAgentProfile {
  return {
    ...profile,
    maxSteps: profile.maxSteps ?? DEFAULT_MAX_STEPS,
    canDelegate: profile.canDelegate ?? DEFAULT_CAN_DELEGATE,
    canSelfEdit: profile.canSelfEdit ?? DEFAULT_CAN_SELF_EDIT,
    nestingDepth: profile.nestingDepth ?? DEFAULT_NESTING_DEPTH,
  };
}

interface AgentMeta {
  activeId: string | null;
}

const DB_NAME = "combo_x_agents";
const STORE = "agents";
const META_STORE = "meta";
const META_KEY = "active";

function openDb(dbName = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("name", "name", { unique: false });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("agents db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export class AgentProfileStore {
  constructor(private readonly dbName = DB_NAME) {}

  async list(): Promise<AgentProfile[]> {
    const db = await openDb(this.dbName);
    try {
      const all = await idbReq<AgentProfile[]>(
        db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
      );
      return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<AgentProfile | null> {
    const db = await openDb(this.dbName);
    try {
      return (
        (await idbReq<AgentProfile | undefined>(
          db.transaction(STORE, "readonly").objectStore(STORE).get(id),
        )) ?? null
      );
    } finally {
      db.close();
    }
  }

  async put(profile: AgentProfile): Promise<AgentProfile> {
    if (!profile.id?.trim()) throw new Error("profile id required");
    if (!profile.name?.trim()) throw new Error("profile name required");
    const now = new Date().toISOString();
    const row: AgentProfile = {
      ...profile,
      createdAt: profile.createdAt || now,
      updatedAt: now,
    };
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(row));
      return row;
    } finally {
      db.close();
    }
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
      const active = await this.getActiveId();
      if (active === id) await this.setActiveId(null);
      return true;
    } finally {
      db.close();
    }
  }

  async getActiveId(): Promise<string | null> {
    const db = await openDb(this.dbName);
    try {
      const meta = await idbReq<AgentMeta & { key: string } | undefined>(
        db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(META_KEY),
      );
      return meta?.activeId ?? null;
    } finally {
      db.close();
    }
  }

  async setActiveId(id: string | null): Promise<void> {
    if (id) {
      const profile = await this.get(id);
      if (!profile) throw new Error(`profile not found: ${id}`);
    }
    const db = await openDb(this.dbName);
    try {
      await idbReq(
        db
          .transaction(META_STORE, "readwrite")
          .objectStore(META_STORE)
          .put({ key: META_KEY, activeId: id } satisfies AgentMeta & { key: string }),
      );
    } finally {
      db.close();
    }
  }
}
