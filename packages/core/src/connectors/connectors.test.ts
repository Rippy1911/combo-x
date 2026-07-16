import { afterEach, describe, expect, it, vi } from "vitest";
import { clearIdeaForgeTokenCache, ideaforgeSearch } from "./ideaforge.js";
import { githubGetFile, githubSearchCode } from "./github.js";

describe("connectors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIdeaForgeTokenCache();
  });

  it("ideaforgeSearch logs in then calls searchKnowledge", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/login")) {
        return new Response(JSON.stringify({ access_token: "tok-1" }), { status: 200 });
      }
      if (url.includes("/functions/searchKnowledge")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                source: "Note",
                title: "Combo RAG",
                snippet: "Local folder index via File System Access",
                id: "n1",
                match_score: 0.9,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await ideaforgeSearch(
      { email: "a@b.c", password: "secret" },
      "local rag",
      5,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.hits[0]?.title).toBe("Combo RAG");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("githubSearchCode maps items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                name: "loop.ts",
                path: "packages/core/src/agent/loop.ts",
                html_url: "https://github.com/x/y/blob/main/loop.ts",
                repository: { full_name: "Rippy1911/combo-x" },
                text_matches: [{ fragment: "rag_search" }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const out = await githubSearchCode({ token: "ghp_x" }, "rag_search", {
      repo: "Rippy1911/combo-x",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.hits[0]?.repo).toBe("Rippy1911/combo-x");
    expect(out.hits[0]?.snippet).toContain("rag_search");
  });

  it("githubGetFile decodes base64", async () => {
    const body = btoa("export const x = 1;\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ encoding: "base64", content: body, size: body.length }), {
          status: 200,
        }),
      ),
    );
    const out = await githubGetFile({ token: "ghp_x" }, "Rippy1911/combo-x", "x.ts");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.content).toContain("export const x");
  });
});
