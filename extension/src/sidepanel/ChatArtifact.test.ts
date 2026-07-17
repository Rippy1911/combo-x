import { describe, expect, it } from "vitest";
import { sandboxForInteractive } from "./ChatArtifact";
import { isSafeChatArtifactSandbox } from "@combo-x/core";

describe("ChatArtifact sandbox", () => {
  it("interactive uses allow-scripts only", () => {
    const s = sandboxForInteractive(true);
    expect(s).toBe("allow-scripts");
    expect(isSafeChatArtifactSandbox(s)).toBe(true);
    expect(s).not.toContain("allow-same-origin");
  });

  it("non-interactive has empty sandbox", () => {
    expect(sandboxForInteractive(false)).toBe("");
  });
});
