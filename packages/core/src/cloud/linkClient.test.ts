import { describe, expect, it, vi } from "vitest";
import { LinkClient } from "./linkClient.js";
import { loadLinkConfig, saveLinkConfig } from "./linkConfig.js";
import { encodeManifest, decodeManifest, encodeSessionBlob, decodeSessionBlob } from "./sessionSync.js";
import type { ChatSession } from "../sessions/store.js";

describe("linkConfig", () => {
  it("defaults and persists", () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    expect(loadLinkConfig(store).linkEnabled).toBe(false);
    const next = saveLinkConfig({ linkEnabled: true }, store);
    expect(next.linkEnabled).toBe(true);
    expect(next.syncChats).toBe(true);
    expect(loadLinkConfig(store).linkEnabled).toBe(true);
  });
});

describe("sessionSync encode", () => {
  it("round-trips session + manifest", () => {
    const session: ChatSession = {
      id: "s1",
      title: "Hi",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:01:00.000Z",
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: "2026-07-20T00:00:00.000Z", source: "link" }],
      totalTokens: 0,
      estimatedCostUsd: 0,
      source: "link",
    };
    const again = decodeSessionBlob(encodeSessionBlob(session));
    expect(again.id).toBe("s1");
    expect(again.messages[0]?.source).toBe("link");
    const man = decodeManifest(
      encodeManifest({
        format: "combo-x-sessions-manifest-v1",
        updatedAt: session.updatedAt,
        sessions: [{ id: "s1", title: "Hi", updatedAt: session.updatedAt, version: 1, source: "link" }],
      }),
    );
    expect(man.sessions[0]?.id).toBe("s1");
  });
});

describe("LinkClient", () => {
  it("heartbeat posts link_enabled", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, device_id: "d1" }), { status: 200 }),
    );
    const client = new LinkClient({
      baseUrl: "https://api.example.test",
      syncToken: "cmb_sync_test",
      deviceId: "d1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const r = await client.heartbeat({ linkEnabled: true, sidepanelOpen: true });
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1]?.body)).link_enabled).toBe(true);
  });

  it("pollCommands parses inbox", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          commands: [{ id: "c1", type: "chat.send", payload: { text: "hi" } }],
        }),
        { status: 200 },
      ),
    );
    const client = new LinkClient({
      baseUrl: "https://api.example.test",
      syncToken: "cmb_sync_test",
      deviceId: "d1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const r = await client.pollCommands(0);
    expect(r.ok).toBe(true);
    expect(r.commands[0]?.type).toBe("chat.send");
  });
});
