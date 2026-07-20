/**
 * Connection probes for Combo Cloud API + OpenAI-compatible LLM endpoints.
 * Used by Settings / Vault Advanced "Test connection" buttons.
 */

export type ProbeResult = {
  ok: boolean;
  latencyMs: number;
  detail: string;
  /** Raw status code when HTTP. */
  status?: number;
};

function elapsed(start: number): number {
  return Math.max(0, Date.now() - start);
}

/** GET {apiBase}/v1/health — Combo Platform / LAN self-host. */
export async function probeComboApi(
  apiBase: string,
  fetchFn: typeof fetch = fetch.bind(globalThis),
): Promise<ProbeResult> {
  const base = apiBase.trim().replace(/\/$/, "");
  if (!base) {
    return { ok: false, latencyMs: 0, detail: "API base URL is empty" };
  }
  const start = Date.now();
  try {
    const res = await fetchFn(`${base}/v1/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const ms = elapsed(start);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: ms,
        status: res.status,
        detail: `HTTP ${res.status}: ${text.slice(0, 160) || res.statusText}`,
      };
    }
    const service = typeof body.service === "string" ? body.service : "ok";
    const db = typeof body.db === "string" ? body.db : "";
    const version = typeof body.version === "string" ? body.version : "";
    return {
      ok: true,
      latencyMs: ms,
      status: res.status,
      detail: [service, version && `v${version}`, db && `db=${db}`, `${ms}ms`]
        .filter(Boolean)
        .join(" · "),
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: elapsed(start),
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** GET {llmBase}/models — Ollama / OpenRouter / custom OpenAI-compat. */
export async function probeLlmEndpoint(
  input: {
    baseUrl: string;
    apiKey?: string;
    keyOptional?: boolean;
  },
  fetchFn: typeof fetch = fetch.bind(globalThis),
): Promise<ProbeResult & { modelCount?: number; sampleIds?: string[] }> {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  if (!base) {
    return { ok: false, latencyMs: 0, detail: "LLM base URL is empty" };
  }
  const key = (input.apiKey ?? "").trim() || (input.keyOptional ? "local" : "");
  if (!key && !input.keyOptional) {
    return { ok: false, latencyMs: 0, detail: "API key required for this provider" };
  }
  const start = Date.now();
  try {
    const res = await fetchFn(`${base}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key || "local"}`,
      },
    });
    const ms = elapsed(start);
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: ms,
        status: res.status,
        detail: `HTTP ${res.status}: ${text.slice(0, 160) || res.statusText}`,
      };
    }
    let ids: string[] = [];
    try {
      const body = JSON.parse(text) as { data?: Array<{ id?: string }> };
      ids = (body.data ?? [])
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter(Boolean);
    } catch {
      return {
        ok: false,
        latencyMs: ms,
        status: res.status,
        detail: "Response was not OpenAI-style { data: [{ id }] }",
      };
    }
    return {
      ok: true,
      latencyMs: ms,
      status: res.status,
      modelCount: ids.length,
      sampleIds: ids.slice(0, 5),
      detail:
        ids.length > 0
          ? `${ids.length} model(s) · e.g. ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? "…" : ""} · ${ms}ms`
          : `Connected but 0 models listed · ${ms}ms (pull a model in Ollama?)`,
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: elapsed(start),
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Normalize LAN / localhost Combo API bases (accept host without scheme). */
export function normalizeComboApiBase(raw: string, fallback: string): string {
  let s = raw.trim().replace(/\/$/, "");
  if (!s) return fallback.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(s)) {
    // 192.168.x.x:8050 or localhost:8050
    s = `http://${s}`;
  }
  return s.replace(/\/$/, "");
}
