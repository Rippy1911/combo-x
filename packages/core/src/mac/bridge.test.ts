import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeMacError,
  macToolOp,
  parseKeyCombo,
  runMacTool,
  type JarvisNativePort,
  type JarvisNativeResponse,
} from "./bridge.js";

function fakePort(opts: {
  connected?: boolean;
  send?: (op: string, args?: Record<string, unknown>) => Promise<JarvisNativeResponse>;
}): JarvisNativePort & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(
    opts.send ??
      (async (op: string) => ({ id: "1", ok: true, data: { op } })),
  );
  return {
    get connected() {
      return opts.connected ?? true;
    },
    send,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("macToolOp", () => {
  it("maps tool names to daemon ops", () => {
    expect(macToolOp("mac_ui_tree")).toBe("ui_tree");
    expect(macToolOp("mac_screenshot")).toBe("screenshot");
    expect(macToolOp("mac_list_dir")).toBe("list_dir");
    expect(macToolOp("index_dir")).toBe("index_dir");
    expect(macToolOp("ambient_recall")).toBe("ambient_recall");
  });
});

describe("runMacTool", () => {
  it("rejects unknown tool", async () => {
    const port = fakePort({});
    const r = await runMacTool("mac_explode", {}, { port });
    expect(r).toEqual({ ok: false, error: "unknown mac tool: mac_explode" });
    expect(port.send).not.toHaveBeenCalled();
  });

  it("reports not connected", async () => {
    const port = fakePort({ connected: false });
    const r = await runMacTool("mac_apps", {}, { port });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/jarvisd not connected/);
    expect(port.send).not.toHaveBeenCalled();
  });

  it("spreads daemon data on success", async () => {
    const port = fakePort({
      send: async () => ({ id: "r1", ok: true, data: { apps: ["Safari"], count: 1 } }),
    });
    const r = await runMacTool("mac_apps", {}, { port });
    expect(r).toEqual({ ok: true, apps: ["Safari"], count: 1 });
    expect(port.send).toHaveBeenCalledWith("apps", {});
  });

  it("maps errors through describeMacError", async () => {
    const port = fakePort({
      send: async () => ({ id: "r1", ok: false, error: "denied:sensitive_app" }),
    });
    const r = await runMacTool("mac_ui_tree", { app: "1Password" }, { port });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(describeMacError("denied:sensitive_app"));
  });

  it("times out hanging sends", async () => {
    vi.useFakeTimers();
    const port = fakePort({
      send: () => new Promise(() => {}),
    });
    const p = runMacTool("mac_apps", {}, { port });
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(r).toEqual({ ok: false, error: "timeout" });
  });

  it("path pre-check short-circuits before send", async () => {
    const port = fakePort({});
    const r = await runMacTool(
      "mac_read_file",
      { path: "/etc/passwd" },
      { port, home: "/Users/me" },
    );
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/path outside the allowed roots/);
    expect(port.send).not.toHaveBeenCalled();
  });

  it("rejects empty mac_type text", async () => {
    const port = fakePort({});
    const r = await runMacTool("mac_type", { text: "   " }, { port });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text|bad_request/);
    expect(port.send).not.toHaveBeenCalled();
  });
});

describe("parseKeyCombo", () => {
  it("accepts valid grammar", () => {
    expect(parseKeyCombo("cmd+c")).toEqual({
      ok: true,
      modifiers: ["cmd"],
      key: "c",
    });
    expect(parseKeyCombo("ctrl+shift+tab")).toEqual({
      ok: true,
      modifiers: ["ctrl", "shift"],
      key: "tab",
    });
    expect(parseKeyCombo("return")).toEqual({
      ok: true,
      modifiers: [],
      key: "return",
    });
  });

  it("rejects invalid grammar", () => {
    expect(parseKeyCombo("").ok).toBe(false);
    expect(parseKeyCombo("cmd+").ok).toBe(false);
    expect(parseKeyCombo("cmd+super+a").ok).toBe(false);
    expect(parseKeyCombo("cmd+foo-bar").ok).toBe(false);
    expect(parseKeyCombo("cmd+verylongkeyname").ok).toBe(false);
    expect(parseKeyCombo("a+b").ok).toBe(false);
  });
});

describe("describeMacError", () => {
  it("maps known codes", () => {
    expect(describeMacError("unavailable:accessibility")).toMatch(/Accessibility/i);
    expect(describeMacError("unavailable:screen_recording")).toMatch(/Screen Recording/i);
    expect(describeMacError("denied:sensitive_app")).toMatch(/sensitive app/);
    expect(describeMacError("denied:path")).toMatch(/allowed roots/);
    expect(describeMacError("custom:code")).toBe("custom:code");
  });
});
