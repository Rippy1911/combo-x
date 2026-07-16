import { describe, expect, it, vi } from "vitest";
import {
  copyText,
  formatMessageTime,
  nodeText,
  shortConversationId,
} from "./chatClipboard";

describe("chatClipboard", () => {
  it("shortConversationId truncates", () => {
    expect(shortConversationId("abcd")).toBe("abcd");
    expect(shortConversationId("0123456789abcdef", 8)).toBe("01234567…");
  });

  it("formatMessageTime returns locale string for valid iso", () => {
    const s = formatMessageTime("2026-07-16T10:30:00.000Z");
    expect(s.length).toBeGreaterThan(4);
    expect(formatMessageTime("not-a-date")).toBe("");
    expect(formatMessageTime(undefined)).toBe("");
  });

  it("nodeText walks nested children", () => {
    expect(nodeText("plain")).toBe("plain");
    expect(nodeText(["a", "b"])).toBe("ab");
    expect(nodeText({ props: { children: "code\nline" } })).toBe("code\nline");
  });

  it("copyText uses clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    await expect(copyText("")).resolves.toBe(false);
    vi.unstubAllGlobals();
  });
});
