import { describe, expect, it } from "vitest";
import { toDownloadDataUrl } from "./downloadDataUrl";

describe("toDownloadDataUrl", () => {
  it("encodes UTF-8 (Polish + emoji)", () => {
    const text = "piadina — żółć 🌿";
    const url = toDownloadDataUrl(text, "text/html");
    expect(url.startsWith("data:text/html;charset=utf-8;base64,")).toBe(true);
    const b64 = url.split(",")[1]!;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  it("defaults mime", () => {
    expect(toDownloadDataUrl("hi").startsWith("data:text/plain;charset=utf-8;base64,")).toBe(
      true,
    );
  });
});
