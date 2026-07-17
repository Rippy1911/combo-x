import { describe, expect, it } from "vitest";
import { resolveEnabledToolsFromSetup } from "./setupApply";

const ALL = ["page_digest", "get_page", "ux_critique", "navigate"] as const;

describe("resolveEnabledToolsFromSetup", () => {
  it("soft sync (focus/mount) keeps previous ceiling", () => {
    const prev = ["page_digest", "ux_critique"];
    expect(
      resolveEnabledToolsFromSetup({
        prev,
        setupTools: ["navigate"],
        allToolNames: ALL,
        opts: {},
      }),
    ).toEqual(prev);
    expect(
      resolveEnabledToolsFromSetup({
        prev,
        setupTools: ["navigate"],
        allToolNames: ALL,
      }),
    ).toEqual(prev);
  });

  it("explicit Apply replaces with setup tools (filtered)", () => {
    expect(
      resolveEnabledToolsFromSetup({
        prev: ["ux_critique"],
        setupTools: ["page_digest", "navigate", "not_a_tool"],
        allToolNames: ALL,
        opts: { syncTools: true },
      }),
    ).toEqual(["page_digest", "navigate"]);
  });
});
