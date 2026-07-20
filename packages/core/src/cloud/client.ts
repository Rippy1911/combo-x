/**
 * Combo Platform CloudClient — auth + ciphertext sync (vault pack).
 * Default base: https://api.combo.nextsolutions.studio
 */

export const DEFAULT_COMBO_API_BASE = "https://api.combo.nextsolutions.studio";

export const CLOUD_CONFIG_KEY = "combo_x_cloud_config";
export const DEVICE_ID_KEY = "combo_x_device_id";

/** Labels mirrored into the unlocked vault when connected. */
export const COMBO_SYNC_TOKEN_LABEL = "combo_sync_token";
export const COMBO_API_BASE_LABEL = "combo_api_base";
export const COMBO_DEVICE_ID_LABEL = "combo_device_id";
export const COMBO_VAULT_PACK_VERSION_LABEL = "combo_vault_pack_version";

export type CloudConfig = {
  apiBase: string;
  syncToken: string;
  deviceId: string;
  packVersion: number;
  /** Tip version for sealed setup pack (connectors). */
  setupPackVersion?: number;
  /** Local preference mirror of server sync_history_keep. */
  syncHistoryKeep?: number;
  email?: string;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function storage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export function ensureDeviceId(store: StorageLike | null = storage()): string {
  const s = store;
  if (!s) return crypto.randomUUID();
  let id = s.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    s.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function loadCloudConfig(store: StorageLike | null = storage()): CloudConfig | null {
  if (!store) return null;
  try {
    const raw = store.getItem(CLOUD_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudConfig;
    if (!parsed?.syncToken) return null;
    return {
      apiBase: parsed.apiBase?.trim() || DEFAULT_COMBO_API_BASE,
      syncToken: parsed.syncToken.trim(),
      deviceId: parsed.deviceId || ensureDeviceId(store),
      packVersion: typeof parsed.packVersion === "number" ? parsed.packVersion : 0,
      setupPackVersion:
        typeof parsed.setupPackVersion === "number" ? parsed.setupPackVersion : 0,
      syncHistoryKeep:
        typeof parsed.syncHistoryKeep === "number" ? parsed.syncHistoryKeep : undefined,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

export function saveCloudConfig(
  cfg: CloudConfig,
  store: StorageLike | null = storage(),
): void {
  if (!store) return;
  store.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cfg));
}

export function clearCloudConfig(store: StorageLike | null = storage()): void {
  if (!store) return;
  if ("removeItem" in store && typeof (store as { removeItem: (k: string) => void }).removeItem === "function") {
    (store as { removeItem: (k: string) => void }).removeItem(CLOUD_CONFIG_KEY);
  } else {
    store.setItem(CLOUD_CONFIG_KEY, "");
  }
}

export type CloudClientOptions = {
  baseUrl?: string;
  syncToken?: string;
  deviceId?: string;
  fetchFn?: typeof fetch;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: { message: text || res.statusText } };
  }
}

export class CloudClient {
  readonly baseUrl: string;
  private syncToken: string;
  readonly deviceId: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: CloudClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_COMBO_API_BASE).replace(/\/$/, "");
    this.syncToken = (options.syncToken ?? "").trim();
    this.deviceId = options.deviceId ?? ensureDeviceId();
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  setSyncToken(token: string): void {
    this.syncToken = token.trim();
  }

  getSyncToken(): string {
    return this.syncToken;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "X-Device-Id": this.deviceId,
    };
    if (this.syncToken) h.Authorization = `Bearer ${this.syncToken}`;
    return h;
  }

  async magicStart(email: string): Promise<{
    ok: boolean;
    email?: string;
    expires_in_sec?: number;
    magic_token?: string;
    error?: string;
  }> {
    const res = await this.fetchFn(this.url("/v1/auth/magic/start"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      email: typeof body.email === "string" ? body.email : email,
      expires_in_sec: typeof body.expires_in_sec === "number" ? body.expires_in_sec : undefined,
      magic_token: typeof body.magic_token === "string" ? body.magic_token : undefined,
    };
  }

  async magicConsume(
    token: string,
    label = "Combo-X",
  ): Promise<{
    ok: boolean;
    sync_token?: string;
    portal_token?: string;
    user_id?: string;
    email?: string;
    plan?: string;
    error?: string;
  }> {
    const res = await this.fetchFn(this.url("/v1/auth/magic/consume"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: token.trim(),
        device_id: this.deviceId,
        label,
      }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    const sync =
      typeof body.sync_token === "string" ? body.sync_token : undefined;
    if (sync) this.syncToken = sync;
    return {
      ok: true,
      sync_token: sync,
      portal_token: typeof body.portal_token === "string" ? body.portal_token : undefined,
      user_id: typeof body.user_id === "string" ? body.user_id : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      plan: typeof body.plan === "string" ? body.plan : undefined,
    };
  }

  /** Create an 8-char pairing code for a second device (requires existing sync token). */
  async pairCreate(): Promise<{ ok: boolean; code?: string; expires_in_sec?: number; error?: string }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/auth/pair"), {
      method: "POST",
      headers: this.authHeaders(),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      code: typeof body.code === "string" ? body.code : undefined,
      expires_in_sec: typeof body.expires_in_sec === "number" ? body.expires_in_sec : undefined,
    };
  }

  async pairConsume(
    code: string,
    label = "Combo-X",
  ): Promise<{ ok: boolean; sync_token?: string; error?: string }> {
    const res = await this.fetchFn(this.url("/v1/auth/pair/consume"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code.trim().toUpperCase(),
        device_id: this.deviceId,
        label,
      }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    const sync =
      typeof body.sync_token === "string" ? body.sync_token : undefined;
    if (sync) this.syncToken = sync;
    return { ok: true, sync_token: sync };
  }

  async syncPush(input: {
    scope: string;
    version: number;
    prev_version?: number;
    ciphertext_b64: string;
  }): Promise<{
    ok: boolean;
    version?: number;
    byte_size?: number;
    error?: string;
    code?: string;
  }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/sync/push"), {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(input),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string; code?: string } | string | undefined;
      return {
        ok: false,
        code: typeof err === "object" ? err?.code : undefined,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      version: typeof body.version === "number" ? body.version : input.version,
      byte_size: typeof body.byte_size === "number" ? body.byte_size : undefined,
    };
  }

  async syncPull(
    scope?: string,
    opts?: { version?: number },
  ): Promise<{
    ok: boolean;
    ciphertext_b64?: string;
    version?: number;
    scopes?: unknown;
    from_history?: boolean;
    error?: string;
  }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const params = new URLSearchParams();
    if (scope) params.set("scope", scope);
    if (opts?.version != null) params.set("version", String(opts.version));
    const q = params.toString() ? `?${params}` : "";
    const res = await this.fetchFn(this.url(`/v1/sync/pull${q}`), {
      method: "GET",
      headers: this.authHeaders(),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      ciphertext_b64:
        typeof body.ciphertext_b64 === "string" ? body.ciphertext_b64 : undefined,
      version: typeof body.version === "number" ? body.version : undefined,
      scopes: body.blobs ?? body.scopes,
      from_history: body.from_history === true,
    };
  }

  async syncHistory(scope: string): Promise<{
    ok: boolean;
    versions?: Array<{
      version: number;
      updated_at: string;
      byte_size: number;
      tip?: boolean;
      sha256?: string | null;
    }>;
    history_keep?: number;
    history_keep_cap?: number;
    error?: string;
  }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(
      this.url(`/v1/sync/history?scope=${encodeURIComponent(scope)}`),
      { method: "GET", headers: this.authHeaders() },
    );
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    const versions = Array.isArray(body.versions) ? body.versions : [];
    return {
      ok: true,
      versions: versions.map((v: Record<string, unknown>) => ({
        version: Number(v.version),
        updated_at: String(v.updated_at ?? ""),
        byte_size: Number(v.byte_size ?? 0),
        tip: v.tip === true,
        sha256: typeof v.sha256 === "string" ? v.sha256 : null,
      })),
      history_keep: typeof body.history_keep === "number" ? body.history_keep : undefined,
      history_keep_cap:
        typeof body.history_keep_cap === "number" ? body.history_keep_cap : undefined,
    };
  }

  async syncSettings(input: { sync_history_keep: number }): Promise<{
    ok: boolean;
    sync_history_keep?: number;
    error?: string;
  }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/sync/settings"), {
      method: "PATCH",
      headers: this.authHeaders(),
      body: JSON.stringify(input),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | string | undefined;
      return {
        ok: false,
        error: typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      sync_history_keep:
        typeof body.sync_history_keep === "number" ? body.sync_history_keep : input.sync_history_keep,
    };
  }

  async me(): Promise<{
    ok: boolean;
    email?: string;
    plan?: string;
    sync_history_keep?: number;
    history_keep_cap?: number;
    error?: string;
  }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/me"), {
      method: "GET",
      headers: this.authHeaders(),
    });
    const body = await parseJson(res);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return {
      ok: true,
      email: typeof body.email === "string" ? body.email : undefined,
      plan: typeof body.plan === "string" ? body.plan : undefined,
      sync_history_keep:
        typeof body.sync_history_keep === "number" ? body.sync_history_keep : undefined,
      history_keep_cap:
        typeof body.history_keep_cap === "number" ? body.history_keep_cap : undefined,
    };
  }
}

export function cloudClientFromConfig(cfg?: CloudConfig | null): CloudClient {
  const c = cfg ?? loadCloudConfig();
  return new CloudClient({
    baseUrl: c?.apiBase ?? DEFAULT_COMBO_API_BASE,
    syncToken: c?.syncToken,
    deviceId: c?.deviceId ?? ensureDeviceId(),
  });
}

/**
 * After unlock: if vault has combo_api_base / combo_sync_token labels, restore
 * localStorage cloud config (survives wipe of localStorage while vault remains).
 */
export async function hydrateCloudConfigFromVault(
  getByLabel: (label: string) => Promise<string | null>,
  store: StorageLike | null = storage(),
): Promise<CloudConfig | null> {
  const apiBase =
    (await getByLabel(COMBO_API_BASE_LABEL))?.trim() ||
    loadCloudConfig(store)?.apiBase ||
    DEFAULT_COMBO_API_BASE;
  const syncToken =
    (await getByLabel(COMBO_SYNC_TOKEN_LABEL))?.trim() ||
    loadCloudConfig(store)?.syncToken ||
    "";
  if (!syncToken) return loadCloudConfig(store);
  const deviceId =
    (await getByLabel(COMBO_DEVICE_ID_LABEL))?.trim() ||
    loadCloudConfig(store)?.deviceId ||
    ensureDeviceId(store);
  const packRaw = await getByLabel(COMBO_VAULT_PACK_VERSION_LABEL);
  const packVersion = Number(packRaw) || loadCloudConfig(store)?.packVersion || 0;
  const cfg: CloudConfig = {
    apiBase: apiBase.replace(/\/$/, "") || DEFAULT_COMBO_API_BASE,
    syncToken,
    deviceId,
    packVersion,
  };
  saveCloudConfig(cfg, store);
  return cfg;
}
