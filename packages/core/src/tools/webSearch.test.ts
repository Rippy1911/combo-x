import { describe, expect, it, vi } from "vitest";
import { webFetchText, webSearchDdg } from "./webSearch.js";

describe("webSearchDdg", () => {
  it("parses DDG html results", async () => {
    const html = `
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example Title</a>
      <a class="result__snippet">Hello snippet</a>
    `;
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    const out = await webSearchDdg("example", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results[0]?.title).toContain("Example");
    expect(out.results[0]?.url).toContain("example.com");
  });

  it("rejects empty query", async () => {
    await expect(webSearchDdg("  ")).resolves.toEqual({ ok: false, error: "query required" });
  });
});

describe("webFetchText", () => {
  it("strips html and truncates", async () => {
    const html = "<html><title>Hi</title><body><p>Hello <b>world</b></p></body></html>";
    const fetchImpl = vi.fn(
      async () =>
        new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );
    const out = await webFetchText("https://example.com", {
      maxChars: 50,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.title).toBe("Hi");
    expect(out.text).toContain("Hello");
  });
});
