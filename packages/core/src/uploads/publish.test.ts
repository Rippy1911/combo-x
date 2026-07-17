import { afterEach, describe, expect, it, vi } from "vitest";
import { dataUrlToBytes, publishUpload } from "./publish.js";

describe("publishUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts multipart to public /upload and returns file_url", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(_url)).toContain("/upload");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          ok: true,
          file_url: "https://uploads.nextsolutions.studio/f/abc.html",
          sha256: "abc",
          size_bytes: 12,
          dedup: false,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await publishUpload({
      filename: "map.html",
      body: "<html></html>",
      workspaceId: "combo-x",
    });
    expect(res).toEqual({
      ok: true,
      file_url: "https://uploads.nextsolutions.studio/f/abc.html",
      sha256: "abc",
      size_bytes: 12,
      dedup: false,
      tier: "public",
    });
    expect(seenHeaders?.["X-FC-Workspace-Id"]).toBe("combo-x");
    expect(seenHeaders?.["X-FC-App-Name"]).toBe("combo-x");
  });

  it("uses /v2/upload when bearerToken set", async () => {
    let seenAuth: string | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/v2/upload");
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return new Response(
        JSON.stringify({
          ok: true,
          file_url: "https://uploads.nextsolutions.studio/p/w/a/x.html",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await publishUpload({
      filename: "x.html",
      body: "hi",
      bearerToken: "fcu_test",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.tier).toBe("protected");
    expect(seenAuth).toBe("Bearer fcu_test");
  });

  it("dataUrlToBytes decodes png data urls", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const out = dataUrlToBytes(png);
    expect(out?.mime).toBe("image/png");
    expect(out!.bytes.length).toBeGreaterThan(10);
  });
});
