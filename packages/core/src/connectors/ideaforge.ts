/** Read-only IdeaForge connector (Base44 login + function invoke). */

export const IDEAForge_DEFAULT_APP_ID = "69d5e793500c2df6a91e0d57";
export const IDEAForge_DEFAULT_HOST = "https://intelligent-strategy-os-hub.base44.app";
export const IDEAForge_API = "https://base44.app/api";

export interface IdeaForgeConfig {
  email: string;
  password: string;
  appId?: string;
  host?: string;
}

export interface IdeaForgeSearchHit {
  source: string;
  title: string;
  snippet: string;
  id?: string;
  score?: number;
}

let cachedToken: { token: string; appId: string; exp: number } | null = null;

export async function ideaforgeLogin(cfg: IdeaForgeConfig): Promise<string> {
  const appId = cfg.appId ?? IDEAForge_DEFAULT_APP_ID;
  if (cachedToken && cachedToken.appId === appId && cachedToken.exp > Date.now()) {
    return cachedToken.token;
  }
  const res = await fetch(`${IDEAForge_API}/apps/${appId}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Id": appId },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IdeaForge login failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("IdeaForge login: no access_token");
  cachedToken = {
    token: data.access_token,
    appId,
    exp: Date.now() + 50 * 60 * 1000,
  };
  return data.access_token;
}

export function clearIdeaForgeTokenCache(): void {
  cachedToken = null;
}

async function invokeFunction(
  cfg: IdeaForgeConfig,
  name: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const appId = cfg.appId ?? IDEAForge_DEFAULT_APP_ID;
  const host = (cfg.host ?? IDEAForge_DEFAULT_HOST).replace(/\/$/, "");
  const token = await ideaforgeLogin(cfg);
  const res = await fetch(`${host}/functions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-App-Id": appId,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err =
      typeof json === "object" && json && "error" in json
        ? String((json as { error: unknown }).error)
        : text.slice(0, 200);
    throw new Error(`IdeaForge ${name} failed (${res.status}): ${err}`);
  }
  return json;
}

/** Search Notes/ProjectDocuments via searchKnowledge (admin session). */
export async function ideaforgeSearch(
  cfg: IdeaForgeConfig,
  query: string,
  limit = 10,
): Promise<{ ok: true; hits: IdeaForgeSearchHit[] } | { ok: false; error: string }> {
  try {
    const raw = (await invokeFunction(cfg, "searchKnowledge", {
      query,
      limit: Math.min(limit, 30),
      expand: true,
    })) as {
      results?: Array<{
        source?: string;
        type?: string;
        title?: string;
        snippet?: string;
        content?: string;
        id?: string;
        match_score?: number;
      }>;
      error?: string;
    };

    const hits: IdeaForgeSearchHit[] = [];
    for (const r of raw.results ?? []) {
      const title = String(r.title ?? "item");
      const content = String(r.snippet ?? r.content ?? "");
      hits.push({
        source: String(r.source ?? r.type ?? "knowledge"),
        title,
        snippet: content.slice(0, 400),
        id: r.id != null ? String(r.id) : undefined,
        score: typeof r.match_score === "number" ? r.match_score : undefined,
      });
    }

    // Fallback: readEntities ProjectDocument substring if empty
    if (hits.length === 0) {
      const docs = (await invokeFunction(cfg, "readEntities", {
        entity: "ProjectDocument",
        limit: 40,
      })) as { rows?: Array<{ id?: string; title?: string; content?: string }>; data?: unknown };

      const rows = Array.isArray(docs.rows)
        ? docs.rows
        : Array.isArray(docs)
          ? (docs as Array<{ id?: string; title?: string; content?: string }>)
          : [];
      const q = query.toLowerCase();
      for (const d of rows) {
        const title = d.title ?? "";
        const content = d.content ?? "";
        if (title.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
          hits.push({
            source: "ProjectDocument",
            title,
            snippet: content.slice(0, 400),
            id: d.id,
          });
        }
        if (hits.length >= limit) break;
      }
    }

    return { ok: true, hits: hits.slice(0, limit) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
