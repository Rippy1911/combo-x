import { describe, expect, it } from "vitest";
import {
  cloneJsonSafe,
  sanitizeSessionBlocks,
  sanitizeSessionTools,
  SessionStore,
} from "./store.js";

describe("SessionStore", () => {
  it("create list search delete", async () => {
    const store = new SessionStore(`sess_test_${crypto.randomUUID()}`);
    const a = await store.create("Alpha chat");
    a.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: "find aironcoach workout plan",
      createdAt: new Date().toISOString(),
    });
    await store.save(a);
    const b = await store.create("Beta chat");
    b.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: "unrelated cooking",
      createdAt: new Date().toISOString(),
    });
    await store.save(b);

    const list = await store.list(10);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.updatedAt >= list[1]!.updatedAt).toBe(true);

    const hits = await store.search("aironcoach", 5);
    expect(hits.some((s) => s.id === a.id)).toBe(true);

    const recent = await store.search("", 5);
    expect(recent.length).toBeGreaterThanOrEqual(2);

    await store.delete(a.id);
    expect(await store.get(a.id)).toBeNull();
  });

  it("empty search lists recent; substring match finds Polish titles", async () => {
    const store = new SessionStore(`sess_pl_${crypto.randomUUID()}`);
    const s = await store.create("Jasne, oto pełna lista 24 EAN-ów");
    s.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: "FoodWell faktura kartonowe EAN",
      createdAt: new Date().toISOString(),
    });
    await store.save(s);
    expect((await store.search("", 10)).some((x) => x.id === s.id)).toBe(true);
    expect((await store.search("FoodWell", 10)).some((x) => x.id === s.id)).toBe(true);
    expect((await store.search("past messages", 10).then((h) => h.map((x) => x.id)))).not.toContain(
      s.id,
    );
  });

  it("sanitizeSessionTools truncates huge results", () => {
    const huge = "x".repeat(20_000);
    const tools = sanitizeSessionTools([
      {
        id: "1",
        name: "extract",
        args: { selector: "table" },
        result: { html: huge },
        status: "done",
      },
    ]);
    const r = tools![0]!.result as { _truncated?: boolean; preview?: string };
    expect(r._truncated).toBe(true);
    expect(r.preview!.length).toBeLessThan(huge.length);
    expect(cloneJsonSafe({ a: 1 })).toEqual({ a: 1 });
  });

  it("persists blocks on assistant messages", async () => {
    const store = new SessionStore(`sess_blocks_${crypto.randomUUID()}`);
    const s = await store.create("Blocks chat");
    s.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "final answer",
      createdAt: new Date().toISOString(),
      blocks: [
        { id: "b1", kind: "thought", text: "step one" },
        { id: "b2", kind: "message", text: "final answer" },
      ],
    });
    await store.save(s);
    const loaded = await store.get(s.id);
    expect(loaded?.messages[0]?.blocks?.length).toBe(2);
    expect(loaded?.messages[0]?.blocks?.[1]?.kind).toBe("message");
  });

  it("sanitizeSessionBlocks drops data-URL src when attachmentId present", () => {
    const dataUrl = `data:image/jpeg;base64,${"A".repeat(800)}`;
    const blocks = sanitizeSessionBlocks([
      {
        id: "a1",
        kind: "artifact",
        artifact: {
          kind: "image",
          title: "Screenshot · ux-viewport",
          src: dataUrl,
          attachmentId: "att-1",
        },
      },
      { id: "t1", kind: "thought", text: "looking" },
    ]);
    expect(blocks?.[0]?.kind).toBe("artifact");
    if (blocks?.[0]?.kind === "artifact") {
      expect(blocks[0].artifact.attachmentId).toBe("att-1");
      expect(blocks[0].artifact.src).toBeUndefined();
    }
    expect(blocks?.[1]?.kind).toBe("thought");
  });

  it("persists session and message bookmarks", async () => {
    const store = new SessionStore(`sess_bm_${crypto.randomUUID()}`);
    const s = await store.create("Bookmarked chat");
    s.bookmarked = true;
    s.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "keep this",
      createdAt: "2026-07-16T12:00:00.000Z",
      bookmarked: true,
    });
    await store.save(s);
    const loaded = await store.get(s.id);
    expect(loaded?.bookmarked).toBe(true);
    expect(loaded?.messages[0]?.bookmarked).toBe(true);
    expect(loaded?.messages[0]?.createdAt).toBe("2026-07-16T12:00:00.000Z");
  });
});
