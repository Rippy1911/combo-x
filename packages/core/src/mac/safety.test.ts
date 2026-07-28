import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAC_ROOTS,
  MAC_SENSITIVE_BUNDLE_IDS,
  checkMacPath,
  isSecureFieldRole,
  isSensitiveApp,
  isTypingTargetAllowed,
} from "./safety.js";

describe("isSensitiveApp", () => {
  it("matches known sensitive bundle ids case-insensitively", () => {
    expect(isSensitiveApp({ bundleId: "com.1password.1password" })).toBe(true);
    expect(isSensitiveApp({ bundleId: "COM.APPLE.TERMINAL" })).toBe(true);
    expect(isSensitiveApp({ bundleId: "com.bitwarden.desktop" })).toBe(true);
    for (const id of MAC_SENSITIVE_BUNDLE_IDS) {
      expect(isSensitiveApp({ bundleId: id })).toBe(true);
    }
  });

  it("matches banking / password window names including Polish banks", () => {
    expect(isSensitiveApp({ name: "mBank — login" })).toBe(true);
    expect(isSensitiveApp({ name: "PKO BP" })).toBe(true);
    expect(isSensitiveApp({ name: "1Password" })).toBe(true);
    expect(isSensitiveApp({ name: "iTerm2" })).toBe(true);
    expect(isSensitiveApp({ name: "Safari" })).toBe(false);
  });

  it("unknown/empty is not sensitive", () => {
    expect(isSensitiveApp({})).toBe(false);
    expect(isSensitiveApp({ name: null, bundleId: null })).toBe(false);
  });
});

describe("isTypingTargetAllowed", () => {
  it("denies unknown and sensitive apps", () => {
    expect(isTypingTargetAllowed({})).toBe(false);
    expect(isTypingTargetAllowed({ name: "", bundleId: "" })).toBe(false);
    expect(isTypingTargetAllowed({ bundleId: "com.apple.Terminal" })).toBe(false);
    expect(isTypingTargetAllowed({ name: "Safari", bundleId: "com.apple.Safari" })).toBe(true);
  });
});

describe("checkMacPath", () => {
  const home = "/Users/me";

  it("accepts allowlisted path with ~/ expansion", () => {
    const r = checkMacPath("~/projects/base44/foo.ts", DEFAULT_MAC_ROOTS, home);
    expect(r).toEqual({ ok: true, path: "/Users/me/projects/base44/foo.ts" });
  });

  it("rejects .. escapes outside root", () => {
    const r = checkMacPath("~/projects/../.ssh/id_rsa", DEFAULT_MAC_ROOTS, home);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("denied:path");
  });

  it("rejects prefix-boundary false positive (proj-evil)", () => {
    const r = checkMacPath("/Users/me/proj-evil/x", ["/Users/me/proj"], home);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("denied:path");
  });

  it("accepts path on segment boundary", () => {
    const r = checkMacPath("/Users/me/proj/x", ["/Users/me/proj"], home);
    expect(r).toEqual({ ok: true, path: "/Users/me/proj/x" });
  });

  it("rejects NUL byte", () => {
    const r = checkMacPath("/Users/me/projects/a\0b", DEFAULT_MAC_ROOTS, home);
    expect(r.ok).toBe(false);
  });

  it("rejects relative paths", () => {
    const r = checkMacPath("projects/base44", DEFAULT_MAC_ROOTS, home);
    expect(r.ok).toBe(false);
  });

  it("rejects empty", () => {
    expect(checkMacPath("", DEFAULT_MAC_ROOTS, home).ok).toBe(false);
  });
});

describe("isSecureFieldRole", () => {
  it("detects AX secure roles", () => {
    expect(isSecureFieldRole("AXSecureTextField")).toBe(true);
    expect(isSecureFieldRole("AXTextField")).toBe(false);
    expect(isSecureFieldRole(null)).toBe(false);
  });
});
