import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJarvisNativePortManager,
  JARVIS_NATIVE_HOST,
  isHostMissingError,
} from "./jarvisNative.js";

type FakePort = {
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: { addListener: (cb: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  _message?: (msg: unknown) => void;
  _disconnect?: () => void;
};

function makePort(): FakePort {
  const port: FakePort = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (cb) => {
        port._message = cb;
      },
    },
    onDisconnect: {
      addListener: (cb) => {
        port._disconnect = cb;
      },
    },
  };
  return port;
}

describe("JarvisNativePortManager", () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { lastError: undefined },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes unsolicited daemon frames to the event handler", async () => {
    const port = makePort();
    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      randomId: () => "req-evt",
    });
    const events: unknown[] = [];
    mgr.onEvent((ev) => events.push(ev));

    const pending = mgr.send("ping");
    port._message?.({ event: "utterance", data: { text: "click save", wakeToken: "wk_1" } });
    port._message?.({ id: "req-evt", ok: true, data: {} });
    await pending;

    expect(events).toEqual([
      { event: "utterance", data: { text: "click save", wakeToken: "wk_1" } },
    ]);
  });

  it("micOwner falls back to offscreen when the daemon is absent", async () => {
    const port = makePort();
    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      randomId: () => "req-owner",
    });
    const pending = mgr.micOwner();
    port._message?.({ id: "req-owner", ok: false, error: "jarvisd not installed" });
    await expect(pending).resolves.toEqual({ owner: "offscreen", listening: false });
  });

  it("micOwner reports the daemon when it claims the mic", async () => {
    const port = makePort();
    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      randomId: () => "req-owner2",
    });
    const pending = mgr.micOwner();
    port._message?.({ id: "req-owner2", ok: true, data: { owner: "daemon", listening: true } });
    await expect(pending).resolves.toEqual({ owner: "daemon", listening: true });
  });

  it("correlates responses by id", async () => {
    const port = makePort();
    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      randomId: () => "req-1",
    });

    const pending = mgr.send("apps", { x: 1 });
    expect(port.postMessage).toHaveBeenCalledWith({ id: "req-1", op: "apps", args: { x: 1 } });
    port._message?.({ id: "req-1", ok: true, data: { apps: ["Finder"] } });
    await expect(pending).resolves.toEqual({
      id: "req-1",
      ok: true,
      data: { apps: ["Finder"] },
      error: undefined,
    });
    expect(mgr.connected).toBe(true);
  });

  it("times out pending requests", async () => {
    vi.useFakeTimers();
    const port = makePort();
    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      timeoutMs: 1000,
      randomId: () => "t1",
    });
    const pending = mgr.send("apps");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ id: "t1", ok: false, error: "jarvisd timeout" });
  });

  it("rejects pending on disconnect", async () => {
    const port = makePort();
    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      randomId: () => "d1",
    });
    const pending = mgr.send("apps");
    port._disconnect?.();
    await expect(pending).resolves.toEqual({
      id: "d1",
      ok: false,
      error: "jarvisd disconnected",
    });
    expect(mgr.connected).toBe(false);
  });

  it("surfaces jarvisd not installed when host is missing", async () => {
    const port = makePort();
    (globalThis as unknown as { chrome: { runtime: { lastError?: { message: string } } } }).chrome =
      {
        runtime: {
          lastError: {
            message: "Specified native messaging host not found.",
          },
        },
      };

    const mgr = createJarvisNativePortManager({
      connectNative: () => port as unknown as chrome.runtime.Port,
      randomId: () => "m1",
    });
    const pending = mgr.send("apps");
    // Disconnect fires with lastError set (Chrome's missing-host path).
    port._disconnect?.();
    await expect(pending).resolves.toEqual({
      id: "m1",
      ok: false,
      error: "jarvisd not installed",
    });
  });

  it("reconnects on the next request after disconnect", async () => {
    let connects = 0;
    let ids = 0;
    const ports = [makePort(), makePort()];
    const mgr = createJarvisNativePortManager({
      connectNative: () => {
        const p = ports[connects++]!;
        return p as unknown as chrome.runtime.Port;
      },
      randomId: () => `id-${++ids}`,
    });

    const first = mgr.send("apps");
    ports[0]!._disconnect?.();
    await first;

    const second = mgr.send("focus", { name: "Safari" });
    expect(connects).toBe(2);
    ports[1]!._message?.({ id: "id-2", ok: true, data: {} });
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it("connectNative targets the jarvisd host id", () => {
    const connectNative = vi.fn(() => makePort() as unknown as chrome.runtime.Port);
    const mgr = createJarvisNativePortManager({
      connectNative,
      randomId: () => "h1",
    });
    void mgr.send("apps");
    expect(connectNative).toHaveBeenCalledWith(JARVIS_NATIVE_HOST);
  });

  it("isHostMissingError detects Chrome wording", () => {
    expect(isHostMissingError("Specified native messaging host not found.")).toBe(true);
    expect(isHostMissingError("other")).toBe(false);
  });
});
