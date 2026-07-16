import type { RestConnector, SecretRef } from "./store.js";

export type GetSecretFn = (label: string) => Promise<string | null>;

function isSecretRef(value: string | SecretRef): value is SecretRef {
  return typeof value === "object" && value != null && "vaultLabel" in value;
}

/** Resolve header map, substituting vault secrets for SecretRef entries. */
export async function resolveHeaders(
  headers: Record<string, string | SecretRef>,
  getSecret: GetSecretFn,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSecretRef(value)) {
      const secret = await getSecret(value.vaultLabel);
      if (secret == null) {
        throw new Error(`vault secret missing: ${value.vaultLabel}`);
      }
      const lower = key.toLowerCase();
      if (lower === "authorization" && !/^Bearer\s/i.test(secret)) {
        out[key] = `Bearer ${secret}`;
      } else {
        out[key] = secret;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface RestRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function buildUrl(baseUrl: string, path: string, query?: RestRequestOptions["query"]): string {
  const base = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${p}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function restRequest(
  connector: RestConnector,
  options: RestRequestOptions,
  getSecret: GetSecretFn,
): Promise<{ ok: true; status: number; data: unknown } | { ok: false; error: string }> {
  try {
    const headers = await resolveHeaders(connector.headers, getSecret);
    const method = (options.method ?? "GET").toUpperCase();
    const url = buildUrl(connector.baseUrl, options.path, options.query);
    const init: RequestInit = { method, headers };
    if (options.body != null && method !== "GET" && method !== "HEAD") {
      init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        init.headers = { ...headers, "Content-Type": "application/json" };
      }
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* plain text */
    }
    if (!res.ok) {
      const snippet =
        typeof data === "object" && data && "message" in data
          ? String((data as { message: unknown }).message)
          : text.slice(0, 240);
      return { ok: false, error: `REST ${res.status}: ${snippet}` };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
