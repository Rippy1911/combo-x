/** Best-effort web search / fetch for non-OpenRouter providers (no API key). */

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

const MAX_FETCH_CHARS = 12_000;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo HTML results (no key). Best-effort — markup can change. */
export async function webSearchDdg(
  query: string,
  opts?: { limit?: number; fetchImpl?: typeof fetch },
): Promise<{ ok: true; query: string; results: WebSearchHit[] } | { ok: false; error: string }> {
  const q = query.trim();
  if (!q) return { ok: false, error: "query required" };
  const limit = Math.min(10, Math.max(1, opts?.limit ?? 5));
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": "Combo-X/1.6 (local web_search; +https://github.com/Rippy1911/combo-x)",
        Accept: "text/html",
      },
    });
    const html = await res.text();
    if (!res.ok) return { ok: false, error: `search HTTP ${res.status}` };

    const results: WebSearchHit[] = [];
    const blockRe =
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) && results.length < limit) {
      const href = m[1] ?? "";
      const title = stripTags(m[2] ?? "");
      const snippet = stripTags(m[3] ?? "");
      if (!href || !title) continue;
      // DDG wraps redirects — unwrap uddg=
      let outUrl = href;
      try {
        const u = new URL(href, "https://duckduckgo.com");
        const uddg = u.searchParams.get("uddg");
        if (uddg) outUrl = decodeURIComponent(uddg);
      } catch {
        /* keep href */
      }
      results.push({ title, url: outUrl, snippet: snippet.slice(0, 280) });
    }

    if (results.length === 0) {
      // Fallback: any result__a links
      const loose = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((m = loose.exec(html)) && results.length < limit) {
        const href = m[1] ?? "";
        const title = stripTags(m[2] ?? "");
        if (!href || !title) continue;
        let outUrl = href;
        try {
          const u = new URL(href, "https://duckduckgo.com");
          const uddg = u.searchParams.get("uddg");
          if (uddg) outUrl = decodeURIComponent(uddg);
        } catch {
          /* keep */
        }
        results.push({ title, url: outUrl, snippet: "" });
      }
    }

    return { ok: true, query: q, results };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch a URL and return truncated plaintext (no key). */
export async function webFetchText(
  url: string,
  opts?: { maxChars?: number; fetchImpl?: typeof fetch },
): Promise<
  | { ok: true; url: string; title?: string; text: string; truncated: boolean }
  | { ok: false; error: string }
> {
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw)) return { ok: false, error: "url must be http(s)" };
  const maxChars = Math.min(MAX_FETCH_CHARS, Math.max(500, opts?.maxChars ?? 8_000));
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await fetchImpl(raw, {
      headers: {
        "User-Agent": "Combo-X/1.6 (local web_fetch)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `fetch HTTP ${res.status}` };
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1] ?? "") : undefined;
    const text = stripTags(body);
    const truncated = text.length > maxChars;
    return {
      ok: true,
      url: res.url || raw,
      title,
      text: text.slice(0, maxChars),
      truncated,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
