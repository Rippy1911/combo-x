/**
 * Encrypted vault — AES-GCM 256 + PBKDF2 (100k, SHA-256).
 * Pattern reused from combo Phase B; DB name namespaced to combo-x.
 */

export const VAULT_KDF_ITERATIONS = 100_000;
export const VAULT_IV_BYTES = 12;
const VERIFIER_PLAINTEXT = "combo-x-vault-verifier-v1";
const SALT_KEY = "__salt__";
const VERIFIER_KEY = "__verifier__";

export class VaultLockedError extends Error {
  constructor() {
    super("vault is locked");
    this.name = "VaultLockedError";
  }
}

export class VaultSealedError extends Error {
  constructor() {
    super("vault is not initialized; call setPassphrase first");
    this.name = "VaultSealedError";
  }
}

function toBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

function fromBytes(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(bytes);
}

async function deriveKek(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", toBytes(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: VAULT_KDF_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(
  kek: CryptoKey,
  plaintext: string,
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(VAULT_IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, toBytes(plaintext));
  return { iv, ciphertext: new Uint8Array(cipher) };
}

async function decrypt(
  kek: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ciphertext);
  return fromBytes(plain);
}

type MetaRec = { id: string; kind: "meta"; value: unknown };
type EntryRec = {
  id: string;
  kind: "entry";
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  createdAt: string;
};
type Rec = MetaRec | EntryRec;

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("vault db open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb failed"));
  });
}

export interface VaultOptions {
  dbName?: string;
  storeName?: string;
}

export class Vault {
  private readonly dbName: string;
  private readonly storeName: string;
  private db: IDBDatabase | null = null;
  private kek: CryptoKey | null = null;

  constructor(options: VaultOptions = {}) {
    this.dbName = options.dbName ?? "combo_x_vault";
    this.storeName = options.storeName ?? "entries";
  }

  isUnlocked(): boolean {
    return this.kek !== null;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb(this.dbName, this.storeName);
    return this.db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error("db not open");
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  private async getMeta<T>(key: string): Promise<T | null> {
    await this.getDb();
    const rec = await idbReq<Rec | undefined>(this.store("readonly").get(key));
    if (!rec || rec.kind !== "meta") return null;
    return rec.value as T;
  }

  private async putMeta(key: string, value: unknown): Promise<void> {
    await this.getDb();
    await idbReq(this.store("readwrite").put({ id: key, kind: "meta", value } satisfies MetaRec));
  }

  async isInitialized(): Promise<boolean> {
    const salt = await this.getMeta<Uint8Array<ArrayBuffer>>(SALT_KEY);
    return salt != null;
  }

  async setPassphrase(passphrase: string): Promise<void> {
    if (!passphrase) throw new Error("passphrase must not be empty");
    if (await this.isInitialized()) throw new Error("vault already initialized");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKek(passphrase, salt);
    const verifier = await encrypt(kek, VERIFIER_PLAINTEXT);
    await this.putMeta(SALT_KEY, salt);
    await this.putMeta(VERIFIER_KEY, verifier);
    this.kek = kek;
  }

  async unlock(passphrase: string): Promise<boolean> {
    if (!passphrase) return false;
    const salt = await this.getMeta<Uint8Array<ArrayBuffer>>(SALT_KEY);
    if (!salt) throw new VaultSealedError();
    const kek = await deriveKek(passphrase, salt);
    const verifier = await this.getMeta<{
      iv: Uint8Array<ArrayBuffer>;
      ciphertext: Uint8Array<ArrayBuffer>;
    }>(VERIFIER_KEY);
    if (!verifier) throw new VaultSealedError();
    try {
      const decoded = await decrypt(kek, verifier.iv, verifier.ciphertext);
      if (decoded !== VERIFIER_PLAINTEXT) return false;
    } catch {
      return false;
    }
    this.kek = kek;
    return true;
  }

  async lock(): Promise<void> {
    this.kek = null;
  }

  async put(label: string, value: string): Promise<string> {
    if (!this.kek) throw new VaultLockedError();
    const id = crypto.randomUUID();
    const { iv, ciphertext } = await encrypt(this.kek, value);
    await this.getDb();
    const rec: EntryRec = {
      id,
      kind: "entry",
      iv,
      ciphertext,
      createdAt: new Date().toISOString(),
    };
    // store label in a meta sidecar keyed by entry id
    await idbReq(this.store("readwrite").put(rec));
    await this.putMeta(`label:${id}`, label);
    return id;
  }

  async get(id: string): Promise<string> {
    if (!this.kek) throw new VaultLockedError();
    await this.getDb();
    const rec = await idbReq<Rec | undefined>(this.store("readonly").get(id));
    if (!rec || rec.kind !== "entry") throw new Error(`entry not found: ${id}`);
    return decrypt(this.kek, rec.iv, rec.ciphertext);
  }

  async getByLabel(label: string): Promise<string | null> {
    if (!this.kek) throw new VaultLockedError();
    await this.getDb();
    const all = await idbReq<Rec[]>(this.store("readonly").getAll());
    for (const rec of all) {
      if (rec.kind !== "entry") continue;
      const lbl = await this.getMeta<string>(`label:${rec.id}`);
      if (lbl === label) return decrypt(this.kek, rec.iv, rec.ciphertext);
    }
    return null;
  }

  async listLabels(): Promise<string[]> {
    await this.getDb();
    const all = await idbReq<Rec[]>(this.store("readonly").getAll());
    const labels: string[] = [];
    for (const rec of all) {
      if (rec.kind !== "entry") continue;
      const lbl = await this.getMeta<string>(`label:${rec.id}`);
      if (lbl) labels.push(lbl);
    }
    return labels;
  }

  /** Find entry id for a label, if any. */
  private async findIdByLabel(label: string): Promise<string | null> {
    await this.getDb();
    const all = await idbReq<Rec[]>(this.store("readonly").getAll());
    for (const rec of all) {
      if (rec.kind !== "entry") continue;
      const lbl = await this.getMeta<string>(`label:${rec.id}`);
      if (lbl === label) return rec.id;
    }
    return null;
  }

  /** Upsert a secret by label (replaces previous ciphertext for that label). */
  async putByLabel(label: string, value: string): Promise<string> {
    if (!this.kek) throw new VaultLockedError();
    const existing = await this.findIdByLabel(label);
    if (existing) {
      const { iv, ciphertext } = await encrypt(this.kek, value);
      await this.getDb();
      const rec: EntryRec = {
        id: existing,
        kind: "entry",
        iv,
        ciphertext,
        createdAt: new Date().toISOString(),
      };
      await idbReq(this.store("readwrite").put(rec));
      return existing;
    }
    return this.put(label, value);
  }

  async deleteByLabel(label: string): Promise<boolean> {
    const id = await this.findIdByLabel(label);
    if (!id) return false;
    await this.getDb();
    await idbReq(this.store("readwrite").delete(id));
    await idbReq(this.store("readwrite").delete(`label:${id}`));
    return true;
  }
}
