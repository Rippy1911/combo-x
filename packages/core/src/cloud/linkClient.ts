/**
 * Combo Link client — heartbeat, command poll, event publish, session snapshots.
 */

import {
  DEFAULT_COMBO_API_BASE,
  cloudClientFromConfig,
  loadCloudConfig,
  type CloudConfig,
} from "./client.js";

export type LinkCommandType =
  | "chat.send"
  | "chat.abort"
  | "session.create"
  | "approval.respond"
  | "vault.put_secrets"
  | "vault.delete_secrets"
  | "setup.upsert_connectors"
  | "setup.apply_bundle"
  | "sync.push_now"
  | "sync.restore_version";

export type LinkCommand = {
  id: string;
  type: LinkCommandType;
  payload: Record<string, unknown>;
  created_at?: string;
  expires_at?: string;
};

export type LinkDevice = {
  device_id: string;
  label: string;
  online: boolean;
  link_enabled: boolean;
  sidepanel_open: boolean;
  last_heartbeat_at?: string | null;
};

export type LinkSessionSnapshot = {
  id: string;
  title: string;
  running?: boolean;
  updated_at?: string;
  messages?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
};

type FetchFn = typeof fetch;

function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.text().then((text) => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: { message: text || res.statusText } };
    }
  });
}

export class LinkClient {
  readonly baseUrl: string;
  readonly deviceId: string;
  private syncToken: string;
  private readonly fetchFn: FetchFn;

  constructor(options: {
    baseUrl?: string;
    syncToken?: string;
    deviceId?: string;
    fetchFn?: FetchFn;
  } = {}) {
    const cfg = loadCloudConfig();
    this.baseUrl = (options.baseUrl ?? cfg?.apiBase ?? DEFAULT_COMBO_API_BASE).replace(/\/$/, "");
    this.syncToken = (options.syncToken ?? cfg?.syncToken ?? "").trim();
    this.deviceId = options.deviceId ?? cfg?.deviceId ?? crypto.randomUUID();
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  static fromCloudConfig(cfg?: CloudConfig | null): LinkClient | null {
    const c = cfg ?? loadCloudConfig();
    if (!c?.syncToken) return null;
    return new LinkClient({
      baseUrl: c.apiBase,
      syncToken: c.syncToken,
      deviceId: c.deviceId,
    });
  }

  setSyncToken(token: string): void {
    this.syncToken = token.trim();
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      Authorization: `Bearer ${this.syncToken}`,
      "X-Device-Id": this.deviceId,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async heartbeat(input: {
    linkEnabled: boolean;
    sidepanelOpen: boolean;
    capabilities?: Record<string, unknown>;
  }): Promise<{ ok: boolean; error?: string }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/link/heartbeat"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        link_enabled: input.linkEnabled,
        sidepanel_open: input.sidepanelOpen,
        capabilities: input.capabilities ?? { combo_x: true },
      }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | undefined;
      return { ok: false, error: err?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  async pollCommands(waitSec = 20): Promise<{
    ok: boolean;
    commands: LinkCommand[];
    error?: string;
  }> {
    if (!this.syncToken) return { ok: false, commands: [], error: "missing sync token" };
    const res = await this.fetchFn(
      this.url(`/v1/link/commands/poll?wait=${Math.max(0, Math.min(25, waitSec))}`),
      { method: "GET", headers: this.headers() },
    );
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | undefined;
      return { ok: false, commands: [], error: err?.message ?? `HTTP ${res.status}` };
    }
    const raw = Array.isArray(body.commands) ? body.commands : [];
    const commands: LinkCommand[] = [];
    for (const c of raw) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.type !== "string") continue;
      commands.push({
        id: o.id,
        type: o.type as LinkCommandType,
        payload:
          typeof o.payload === "object" && o.payload !== null
            ? (o.payload as Record<string, unknown>)
            : {},
        created_at: typeof o.created_at === "string" ? o.created_at : undefined,
        expires_at: typeof o.expires_at === "string" ? o.expires_at : undefined,
      });
    }
    return { ok: true, commands };
  }

  /** Enqueue a Link command for a device (sync token OK — Cursor vault-admin). */
  async enqueueCommand(input: {
    targetDeviceId: string;
    type: LinkCommandType;
    payload?: Record<string, unknown>;
  }): Promise<{ ok: boolean; command_id?: string; error?: string }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/link/commands"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        target_device_id: input.targetDeviceId,
        type: input.type,
        payload: input.payload ?? {},
      }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | undefined;
      return { ok: false, error: err?.message ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      command_id: typeof body.command_id === "string" ? body.command_id : undefined,
    };
  }

  async ackCommand(
    id: string,
    status: "acked" | "done" | "failed",
    error?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url(`/v1/link/commands/${encodeURIComponent(id)}/ack`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ status, error }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | undefined;
      return { ok: false, error: err?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  async publishEvents(
    events: Array<Record<string, unknown>>,
    opts?: { sessionId?: string; commandId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    if (!events.length) return { ok: true };
    const res = await this.fetchFn(this.url("/v1/link/events"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        session_id: opts?.sessionId,
        command_id: opts?.commandId,
        events,
      }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | undefined;
      return { ok: false, error: err?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  async upsertSessions(
    sessions: LinkSessionSnapshot[],
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.syncToken) return { ok: false, error: "missing sync token" };
    const res = await this.fetchFn(this.url("/v1/link/sessions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          running: !!s.running,
          updated_at: s.updated_at,
          messages: s.messages ?? [],
          meta: s.meta ?? {},
        })),
      }),
    });
    const body = await parseJson(res);
    if (!res.ok || body.ok === false) {
      const err = body.error as { message?: string } | undefined;
      return { ok: false, error: err?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }
}

export function linkClientFromConfig(cfg?: CloudConfig | null): LinkClient | null {
  return LinkClient.fromCloudConfig(cfg ?? loadCloudConfig());
}

/** Portal helper (uses portal token — not the extension sync token). */
export async function portalLinkDevices(
  apiBase: string,
  portalToken: string,
  fetchFn: FetchFn = fetch.bind(globalThis),
): Promise<{ ok: boolean; devices?: LinkDevice[]; error?: string }> {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetchFn(`${base}/v1/link/devices`, {
    method: "GET",
    headers: { Authorization: `Bearer ${portalToken}` },
  });
  const body = await parseJson(res);
  if (!res.ok || body.ok === false) {
    const err = body.error as { message?: string } | undefined;
    return { ok: false, error: err?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, devices: (body.devices as LinkDevice[]) ?? [] };
}

export { cloudClientFromConfig };
