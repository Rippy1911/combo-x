import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectKind, parseAttachment } from "./parse.js";
import { AttachmentStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

describe("attachments parse", () => {
  it("detectKind by ext/mime", () => {
    expect(detectKind("a.pdf", "application/pdf")).toBe("pdf");
    expect(detectKind("a.csv", "text/csv")).toBe("csv");
    expect(detectKind("shot.png", "image/png")).toBe("image");
    expect(detectKind("notes.md", "")).toBe("md");
  });

  it("parses plain text and csv", async () => {
    const txt = await parseAttachment(
      new TextEncoder().encode("hello combo attachments"),
      "note.txt",
      "text/plain",
    );
    expect(txt.kind).toBe("txt");
    expect(txt.text).toContain("hello combo");

    const csv = await parseAttachment(
      new TextEncoder().encode("name,value\nalpha,1\n"),
      "data.csv",
      "text/csv",
    );
    expect(csv.kind).toBe("csv");
    expect(csv.text).toContain("alpha,1");
  });

  it("extracts PDF fixture text", async () => {
    const out = await parseAttachment(fixture("sample.pdf"), "sample.pdf", "application/pdf");
    expect(out.error).toBeUndefined();
    expect(out.kind).toBe("pdf");
    expect(out.text).toContain("Combo Fixture Report");
  }, 30_000);

  it("reads XLSX fixture", async () => {
    const out = await parseAttachment(
      fixture("sample.xlsx"),
      "sample.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(out.error).toBeUndefined();
    expect(out.kind).toBe("xlsx");
    expect(out.text).toContain("alpha");
    expect(out.text).toContain("beta");
  });

  it("builds image data URL", async () => {
    // 1x1 PNG
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const out = await parseAttachment(png, "dot.png", "image/png");
    expect(out.kind).toBe("image");
    expect(out.dataUrl?.startsWith("data:image/")).toBe(true);
  });
});

describe("AttachmentStore", () => {
  it("put list read", async () => {
    const store = new AttachmentStore(`attach_test_${crypto.randomUUID()}`);
    const id = crypto.randomUUID();
    await store.put({
      id,
      sessionId: "sess1",
      name: "a.txt",
      mime: "text/plain",
      kind: "txt",
      size: 5,
      text: "hello world from attachment store",
      meta: {},
      truncated: false,
      createdAt: Date.now(),
    });
    const listed = await store.list("sess1");
    expect(listed.some((r) => r.id === id)).toBe(true);
    const body = await store.read(id, 20);
    expect(body?.content).toBe("hello world from att");
    expect(body?.truncated).toBe(true);
  });

  it("listScreenshots + remove + totalBytes", async () => {
    const store = new AttachmentStore(`attach_shots_${crypto.randomUUID()}`);
    const shotId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    await store.put({
      id: shotId,
      sessionId: "s",
      name: "screenshot-home.png",
      mime: "image/png",
      kind: "image",
      size: 1200,
      text: "",
      dataUrl: "data:image/png;base64,aa",
      meta: { vision: true, source: "ux-viewport" },
      truncated: false,
      createdAt: Date.now(),
    });
    await store.put({
      id: otherId,
      sessionId: "s",
      name: "notes.txt",
      mime: "text/plain",
      kind: "txt",
      size: 40,
      text: "hi",
      meta: {},
      truncated: false,
      createdAt: Date.now(),
    });
    const shots = await store.listScreenshots();
    expect(shots.map((r) => r.id)).toEqual([shotId]);
    expect(await store.totalBytes()).toBe(1240);
    await store.remove(shotId);
    expect(await store.listScreenshots()).toHaveLength(0);
    expect(await store.totalBytes()).toBe(40);
  });
});
