/** Durable connector definitions (REST + remote MCP) in IndexedDB. */

export interface SecretRef {
  vaultLabel: string;
}

export interface RestToolSpec {
  name: string;
  method?: string;
  path: string;
  description?: string;
}

export interface RestConnector {
  id: string;
  kind: "rest";
  name: string;
  baseUrl: string;
  headers: Record<string, string | SecretRef>;
  tools?: RestToolSpec[];
  /** When set, connector belongs to this vault (private/work isolation). */
  vaultId?: string;
}

export interface McpConnector {
  id: string;
  kind: "mcp";
  name: string;
  transport: "http" | "sse";
  url: string;
  headers: Record<string, string | SecretRef>;
  toolsCache?: unknown;
  vaultId?: string;
}

export type Connector = RestConnector | McpConnector;

const DB_NAME = "combo_x_connectors";
const STORE = "connectors";

function openDb(dbName = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("kind", "kind", { unique: false });
        os.createIndex("name", "name", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("connectors db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export class ConnectorStore {
  constructor(private readonly dbName = DB_NAME) {}

  async list(vaultId?: string | null): Promise<Connector[]> {
    const db = await openDb(this.dbName);
    try {
      const all = await idbReq<Connector[]>(
        db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
      );
      if (vaultId == null || vaultId === "") return all;
      return all.filter((c) => !c.vaultId || c.vaultId === vaultId);
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<Connector | null> {
    const db = await openDb(this.dbName);
    try {
      return (
        (await idbReq<Connector | undefined>(
          db.transaction(STORE, "readonly").objectStore(STORE).get(id),
        )) ?? null
      );
    } finally {
      db.close();
    }
  }

  async put(connector: Connector): Promise<Connector> {
    if (!connector.id?.trim()) throw new Error("connector id required");
    if (!connector.name?.trim()) throw new Error("connector name required");
    const db = await openDb(this.dbName);
    try {
      await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(connector));
      return connector;
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
      return true;
    } finally {
      db.close();
    }
  }

  async listByKind<K extends Connector["kind"]>(kind: K): Promise<Extract<Connector, { kind: K }>[]> {
    const all = await this.list();
    return all.filter((c): c is Extract<Connector, { kind: K }> => c.kind === kind);
  }
}
