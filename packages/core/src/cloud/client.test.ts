import { describe, expect, it, vi } from "vitest";
import { CloudClient, DEFAULT_COMBO_API_BASE } from "./client.js";

describe("CloudClient", () => {
  it("posts magic start to default base", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, email: "a@b.c", magic_token: "tok" }), {
        status: 200,
      }),
    );
    const client = new CloudClient({
      baseUrl: DEFAULT_COMBO_API_BASE,
      deviceId: "dev-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const res = await client.magicStart("a@b.c");
    expect(res.ok).toBe(true);
    expect(res.magic_token).toBe("tok");
    expect(String(fetchFn.mock.calls.at(0)?.at(0))).toBe(
      `${DEFAULT_COMBO_API_BASE}/v1/auth/magic/start`,
    );
  });

  it("syncPush sends bearer + ciphertext", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.scope).toBe("vault");
      expect(body.ciphertext_b64).toBe("YQ==");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer cmb_sync_x");
      return new Response(JSON.stringify({ ok: true, version: 2 }), { status: 200 });
    });
    const client = new CloudClient({
      syncToken: "cmb_sync_x",
      deviceId: "dev-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const res = await client.syncPush({
      scope: "vault",
      version: 2,
      ciphertext_b64: "YQ==",
    });
    expect(res.ok).toBe(true);
    expect(res.version).toBe(2);
  });
});
