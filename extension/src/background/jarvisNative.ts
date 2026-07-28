export interface JarvisNativeResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export const JARVIS_NATIVE_HOST = "studio.nextsolutions.jarvisd";
export const JARVIS_NATIVE_TIMEOUT_MS = 45_000;

type Pending = {
  resolve: (res: JarvisNativeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type ConnectNativeFn = (host: string) => chrome.runtime.Port;

/**
 * Frames the daemon pushes without being asked (no `id`), e.g. an utterance it heard while
 * it owned the microphone. The daemon-side wake pipeline is not implemented yet; this is the
 * channel it will use (see docs/JARVIS.md §5).
 */
export interface JarvisNativeEvent {
  event: string;
  data?: unknown;
}

/**
 * Lazily connects to jarvisd, correlates requests by id, times out at 45s,
 * and rejects pending on disconnect. Reconnects on the next send().
 */
export class JarvisNativePortManager {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, Pending>();
  private _connected = false;
  private readonly connectNative: ConnectNativeFn;
  private readonly timeoutMs: number;
  private readonly randomId: () => string;
  private eventHandler: ((event: JarvisNativeEvent) => void) | null = null;

  constructor(opts?: {
    connectNative?: ConnectNativeFn;
    timeoutMs?: number;
    randomId?: () => string;
  }) {
    this.connectNative =
      opts?.connectNative ??
      ((host) => chrome.runtime.connectNative(host));
    this.timeoutMs = opts?.timeoutMs ?? JARVIS_NATIVE_TIMEOUT_MS;
    this.randomId = opts?.randomId ?? (() => crypto.randomUUID());
  }

  get connected(): boolean {
    return this._connected;
  }

  onEvent(handler: ((event: JarvisNativeEvent) => void) | null): void {
    this.eventHandler = handler;
  }

  /** Ask the daemon who owns the microphone; falls back to the offscreen tier. */
  async micOwner(): Promise<{ owner: "offscreen" | "daemon"; listening: boolean }> {
    const res = await this.send("mic_owner");
    const data = (res.ok ? res.data : null) as
      | { owner?: unknown; listening?: unknown }
      | null;
    return {
      owner: data?.owner === "daemon" ? "daemon" : "offscreen",
      listening: Boolean(data?.listening),
    };
  }

  async send(op: string, args: Record<string, unknown> = {}): Promise<JarvisNativeResponse> {
    const id = this.randomId();
    let port: chrome.runtime.Port;
    try {
      port = this.ensurePort();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id,
        ok: false,
        error: isHostMissingError(msg) ? "jarvisd not installed" : msg,
      };
    }

    return new Promise<JarvisNativeResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, ok: false, error: "jarvisd timeout" });
      }, this.timeoutMs);

      this.pending.set(id, { resolve, timer });

      try {
        port.postMessage({ id, op, args });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        const msg = err instanceof Error ? err.message : String(err);
        resolve({
          id,
          ok: false,
          error: isHostMissingError(msg) ? "jarvisd not installed" : msg,
        });
      }

      // connectNative reports missing host via onDisconnect + lastError.
      queueMicrotask(() => {
        const last = chrome.runtime?.lastError?.message;
        if (last && isHostMissingError(last) && this.pending.has(id)) {
          clearTimeout(timer);
          this.pending.delete(id);
          this.teardownPort();
          resolve({ id, ok: false, error: "jarvisd not installed" });
        }
      });
    });
  }

  /** Test helper — force-disconnect as if the daemon went away. */
  simulateDisconnect(error = "jarvisd disconnected"): void {
    this.rejectAll(error);
    this.teardownPort();
  }

  private ensurePort(): chrome.runtime.Port {
    if (this.port && this._connected) return this.port;

    let port: chrome.runtime.Port;
    try {
      port = this.connectNative(JARVIS_NATIVE_HOST);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(isHostMissingError(msg) ? "jarvisd not installed" : msg);
    }

    this.port = port;
    this._connected = true;

    port.onMessage.addListener((msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const res = msg as JarvisNativeResponse & JarvisNativeEvent;
      if (typeof res.id !== "string") {
        if (typeof res.event === "string") {
          this.eventHandler?.({ event: res.event, data: res.data });
        }
        return;
      }
      const pending = this.pending.get(res.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(res.id);
      pending.resolve({
        id: res.id,
        ok: Boolean(res.ok),
        data: res.data,
        error: res.error,
      });
    });

    port.onDisconnect.addListener(() => {
      const last = chrome.runtime?.lastError?.message ?? "";
      const error = isHostMissingError(last)
        ? "jarvisd not installed"
        : "jarvisd disconnected";
      this.rejectAll(error);
      this.teardownPort();
    });

    return port;
  }

  private rejectAll(error: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ id, ok: false, error });
    }
    this.pending.clear();
  }

  private teardownPort(): void {
    this._connected = false;
    const p = this.port;
    this.port = null;
    try {
      p?.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export function isHostMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("native messaging host not found") ||
    m.includes("specified native messaging host") ||
    m.includes("jarvisd not installed")
  );
}

export function createJarvisNativePortManager(
  opts?: ConstructorParameters<typeof JarvisNativePortManager>[0],
): JarvisNativePortManager {
  return new JarvisNativePortManager(opts);
}
