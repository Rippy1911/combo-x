import { describe, expect, it } from "vitest";
import { chatArtifactSandbox, isSafeChatArtifactSandbox } from "./sandbox.js";

describe("chatArtifactSandbox", () => {
  it("interactive is allow-scripts only", () => {
    expect(chatArtifactSandbox(true)).toBe("allow-scripts");
    expect(isSafeChatArtifactSandbox(chatArtifactSandbox(true))).toBe(true);
  });

  it("non-interactive is empty", () => {
    expect(chatArtifactSandbox(false)).toBe("");
    expect(isSafeChatArtifactSandbox("")).toBe(true);
  });

  it("rejects allow-same-origin with scripts", () => {
    expect(isSafeChatArtifactSandbox("allow-scripts allow-same-origin")).toBe(false);
  });

  it("rejects top-navigation / popups", () => {
    expect(isSafeChatArtifactSandbox("allow-scripts allow-popups")).toBe(false);
  });
});
