/** Read-only GitHub connector (PAT from vault). */

export interface GitHubConfig {
  token: string;
}

export interface GitHubCodeHit {
  repo: string;
  path: string;
  url: string;
  snippet: string;
}

async function gh(
  cfg: GitHubConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
}

export async function githubSearchCode(
  cfg: GitHubConfig,
  query: string,
  options: { repo?: string; limit?: number } = {},
): Promise<{ ok: true; hits: GitHubCodeHit[] } | { ok: false; error: string }> {
  try {
    const limit = Math.min(options.limit ?? 10, 30);
    const q = options.repo ? `${query} repo:${options.repo}` : query;
    const res = await gh(
      cfg,
      `/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`,
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `GitHub search ${res.status}: ${t.slice(0, 240)}` };
    }
    const data = (await res.json()) as {
      items?: Array<{
        name: string;
        path: string;
        html_url: string;
        repository?: { full_name?: string };
        text_matches?: Array<{ fragment?: string }>;
      }>;
    };
    const hits: GitHubCodeHit[] = (data.items ?? []).map((it) => ({
      repo: it.repository?.full_name ?? "",
      path: it.path,
      url: it.html_url,
      snippet: it.text_matches?.[0]?.fragment?.slice(0, 400) ?? it.name,
    }));
    return { ok: true, hits };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function githubGetFile(
  cfg: GitHubConfig,
  repo: string,
  path: string,
  ref?: string,
): Promise<{ ok: true; content: string; truncated: boolean } | { ok: false; error: string }> {
  try {
    const [owner, name] = repo.split("/");
    if (!owner || !name) return { ok: false, error: "repo must be owner/name" };
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const res = await gh(cfg, `/repos/${owner}/${name}/contents/${path.replace(/^\//, "")}${qs}`);
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `GitHub get file ${res.status}: ${t.slice(0, 240)}` };
    }
    const data = (await res.json()) as { content?: string; encoding?: string; size?: number };
    if (data.encoding !== "base64" || !data.content) {
      return { ok: false, error: "unexpected GitHub contents response" };
    }
    const decoded = atob(data.content.replace(/\n/g, ""));
    const truncated = decoded.length > 40_000;
    return {
      ok: true,
      content: truncated ? decoded.slice(0, 40_000) : decoded,
      truncated,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
