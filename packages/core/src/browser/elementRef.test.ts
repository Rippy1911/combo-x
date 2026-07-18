import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCssPath,
  formatActiveTabBlock,
  formatBrowserContextBlock,
  formatPickedElementsBlock,
  pickedElementChipLabel,
} from "./elementRef.js";
import { buildPickedElementRef } from "./content-handlers.js";

describe("buildCssPath", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers unique id", () => {
    document.body.innerHTML = `<button id="save-btn">Save</button>`;
    const el = document.getElementById("save-btn")!;
    expect(buildCssPath(el)).toBe("#save-btn");
  });
});

describe("buildPickedElementRef", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("includes interactive index for buttons", () => {
    document.body.innerHTML = `<button id="one">One</button><button id="two">Two</button>`;
    const el = document.getElementById("two") as HTMLElement;
    const ref = buildPickedElementRef(el, document);
    expect(ref.selector).toBe("#two");
    expect(ref.interactiveIndex).toBe(1);
    expect(ref.tag).toBe("button");
    expect(ref.text).toBe("Two");
    expect(formatPickedElementsBlock([ref])).toContain("interactiveIndex: 1");
    expect(pickedElementChipLabel(ref)).toContain("Two");
  });

  it("resolves closest interactive ancestor for nested text", () => {
    document.body.innerHTML = `<button id="wrap"><span id="inner">Go</span></button>`;
    const inner = document.getElementById("inner") as HTMLElement;
    const ref = buildPickedElementRef(inner, document);
    expect(ref.tag).toBe("button");
    expect(ref.interactiveIndex).toBe(0);
    expect(ref.selector).toBe("#wrap");
  });

  it("captures aria-label / class / outerHTML metadata", () => {
    document.body.innerHTML = `<button id="more" class="btn ghost" aria-label="MORE options">…</button>`;
    const el = document.getElementById("more") as HTMLElement;
    const ref = buildPickedElementRef(el, document);
    expect(ref.ariaLabel).toBe("MORE options");
    expect(ref.className).toContain("btn");
    expect(ref.outerHtml).toContain("MORE options");
    const block = formatBrowserContextBlock({
      tab: { url: "https://example.com/w", title: "Workout", tabId: 3, at: "2026-07-17T08:00:00.000Z" },
      picks: [ref],
    });
    expect(block).toContain("## Active browser tab");
    expect(block).toContain("https://example.com/w");
    expect(block).toContain("## Picked element(s)");
    expect(block).toContain("aria-label");
    expect(formatActiveTabBlock({ at: "t", url: "https://x" })).toContain("url: https://x");
  });
});
