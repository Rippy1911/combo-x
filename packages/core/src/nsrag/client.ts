/**
 * ns-rag portfolio knowledge client (Neon + pgvector over _docs/_memory).
 * Takes a vault getSecret — never logs or returns the key.
 */

export const NS_RAG_API_KEY_LABEL = "ns_rag_api_key";
export const NS_RAG_BASE_LABEL = "ns_rag_base_url";
export const DEFAULT_NS_RAG_BASE = "https://rag.nextsolutions.studio";

const SNIPPET_MAX = 500;
const REQUEST_MS = 20_000;

export interface NsRagDeps {
  getSecret: (label: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface NsRagCitation {
  path: string;
  score?: number;
  snippet?: string;
  heading?: string;
}

export interface NsRagAskResult {
  ok: boolean;
  answer?: string;
  citations?: NsRagCitation[];
  error?: string;
}

export interface NsRagSearchResult {
  ok: boolean;
  hits?: NsRagCitation[];
  error?: string;
}

export function normalizeRagBase(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_NS_RAG_BASE;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function truncateSnippet(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  return s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX) : s;
}

function mapCitation(raw: Record<string, unknown>): NsRagCitation | null {
  const path =
    typeof raw.path === "string"
      ? raw.path
      : typeof raw.source_path === "string"
        ? raw.source_path
        : "";
  if (!path) return null;
  const heading =
    typeof raw.heading === "string"
      ? raw.heading
      : typeof raw.section === "string"
        ? raw.section
        : undefined;
  const score = typeof raw.score === "number" ? raw.score : undefined;
  const snippet = truncateSnippet(
    typeof raw.snippet === "string" ? raw.snippet : undefined,
  );
  return { path, score, snippet, heading };
}

function scrubError(msg: string, key: string | null): string {
  if (!key) return msg;
  return msg.split(key).join("[redacted]");
}

async function resolveAuth(
  deps: NsRagDeps,
): Promise<{ ok: true; key: string; base: string; fetchFn: typeof fetch } | { ok: false; error: string }> {
  const key = (await deps.getSecret(NS_RAG_API_KEY_LABEL))?.trim() || null;
  if (!key) {
    return { ok: false, error: "ns_rag_api_key missing in vault" };
  }
  const baseRaw = await deps.getSecret(NS_RAG_BASE_LABEL);
  const base = normalizeRagBase(baseRaw);
  const fetchFn = deps.fetchImpl ?? fetch.bind(globalThis);
  return { ok: true, key, base, fetchFn };
}

export async function portfolioAsk(
  query: string,
  deps: NsRagDeps,
  opts?: { k?: number },
): Promise<NsRagAskResult> {
  let key: string | null = null;
  try {
    const auth = await resolveAuth(deps);
    if (!auth.ok) return { ok: false, error: auth.error };
    key = auth.key;
    const k = opts?.k ?? 8;
    const signal = timeoutSignal(REQUEST_MS);
    const res = await auth.fetchFn(`${auth.base}/ask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, k }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      return { ok: false, error: `ns_rag_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const answer = typeof data.answer === "string" ? data.answer : undefined;
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const citations = sources
      .map((s) => (s && typeof s === "object" ? mapCitation(s as Record<string, unknown>) : null))
      .filter((c): c is NsRagCitation => c != null);
    return { ok: true, answer, citations };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: scrubError(msg, key) };
  }
}

let mcpId = 1;

export async function portfolioSearch(
  query: string,
  deps: NsRagDeps,
  opts?: { k?: number },
): Promise<NsRagSearchResult> {
  let key: string | null = null;
  try {
    const auth = await resolveAuth(deps);
    if (!auth.ok) return { ok: false, error: auth.error };
    key = auth.key;
    const k = opts?.k ?? 8;
    const id = mcpId++;
    const signal = timeoutSignal(REQUEST_MS);
    const res = await auth.fetchFn(`${auth.base}/v1/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "search_portfolio", arguments: { query, k } },
      }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      return { ok: false, error: `ns_rag_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (data.error && typeof data.error === "object") {
      const err = data.error as { message?: string };
      return {
        ok: false,
        error: scrubError(err.message || "ns_rag_mcp_error", key),
      };
    }
    const result = data.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
    const textPart = result?.content?.find((p) => p?.type === "text" && typeof p.text === "string");
    if (!textPart?.text) {
      return { ok: false, error: "ns_rag_empty_result" };
    }
    let rows: unknown;
    try {
      rows = JSON.parse(textPart.text);
    } catch {
      return { ok: false, error: "ns_rag_bad_result" };
    }
    if (!Array.isArray(rows)) {
      return { ok: false, error: "ns_rag_bad_result" };
    }
    const hits = rows
      .map((s) => (s && typeof s === "object" ? mapCitation(s as Record<string, unknown>) : null))
      .filter((c): c is NsRagCitation => c != null);
    return { ok: true, hits };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: scrubError(msg, key) };
  }
}
