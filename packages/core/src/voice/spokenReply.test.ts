import { describe, expect, it } from "vitest";
import { COMBO_VOICE_SYSTEM_ADDON, SPOKEN_WORD_CAP, toSpokenReply } from "./spokenReply.js";

describe("toSpokenReply", () => {
  it("drops fenced code blocks", () => {
    expect(toSpokenReply("Hi\n```js\nconst x=1\n```\nthere")).toBe("Hi there");
  });

  it("extracts link labels and replaces bare URLs", () => {
    expect(toSpokenReply("See [docs](https://example.com) and https://x.test/a")).toBe(
      "See docs and link",
    );
  });

  it("caps words at a sentence boundary", () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`);
    const text = words.slice(0, 10).join(" ") + ". " + words.slice(10).join(" ") + " more.";
    const out = toSpokenReply(text, { wordCap: 12 });
    expect(out.endsWith(".")).toBe(true);
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("appends ellipsis when cut mid-sentence", () => {
    const text = Array.from({ length: SPOKEN_WORD_CAP + 5 }, (_, i) => `word${i}`).join(
      " ",
    );
    const out = toSpokenReply(text);
    expect(out.endsWith("…")).toBe(true);
    expect(out.replace(/…$/, "").split(/\s+/).length).toBe(SPOKEN_WORD_CAP);
  });

  it("redacts long tokens", () => {
    const long = "a".repeat(50);
    expect(toSpokenReply(`secret ${long} ok`)).toBe("secret a long value ok");
  });

  it("exposes a short spoken system addon", () => {
    expect(COMBO_VOICE_SYSTEM_ADDON.toLowerCase()).toContain("spoken");
    expect(COMBO_VOICE_SYSTEM_ADDON.toLowerCase()).toContain("markdown");
  });
});
