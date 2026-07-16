/**
 * MAIN-world injector. Runs via chrome.scripting.executeScript({ world: "MAIN", func, args }).
 * Must stay serializable — no closures over extension secrets.
 */

export type PageExtInjectArgs = {
  scriptId: string;
  name: string;
  source: string;
  /** Channels allowed to export (empty = export no-ops / throws). */
  exportChannels: string[];
  allowStorage: boolean;
  /** Per-injection capability token — required on every bridge postMessage. */
  bridgeToken: string;
};

/**
 * This function is cloned into the page MAIN world. Do not reference outer scope.
 * Provides `ComboX` API: { id, name, export, storage:{get,set,delete,list}, log }.
 */
export function runPageExtensionInMainWorld(args: PageExtInjectArgs): { ok: boolean; error?: string } {
  try {
    if (!args.bridgeToken) return { ok: false, error: "missing bridgeToken" };
    // Non-enumerable so page scripts cannot discover scriptIds via Object.keys
    const flagKey = `__combo_x_inj`;
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = g[flagKey];
    const seen =
      prev && typeof prev === "object" && prev !== null
        ? (prev as Record<string, boolean>)
        : Object.create(null) as Record<string, boolean>;
    if (seen[args.scriptId]) return { ok: true };
    seen[args.scriptId] = true;
    try {
      Object.defineProperty(g, flagKey, {
        value: seen,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch {
      g[flagKey] = seen;
    }

    const post = (kind: string, channel: string, payload: unknown) => {
      try {
        globalThis.postMessage(
          {
            source: "combo-x-page-ext",
            kind,
            scriptId: args.scriptId,
            bridgeToken: args.bridgeToken,
            channel,
            payload,
          },
          location.origin,
        );
      } catch {
        /* ignore */
      }
    };

    const ComboX = {
      id: args.scriptId,
      name: args.name,
      export(channel: string, payload: unknown) {
        if (!args.exportChannels.includes(channel)) {
          throw new Error(`export channel not allowed: ${channel}`);
        }
        post("export", channel, payload);
      },
      storage: {
        get(key: string) {
          if (!args.allowStorage) throw new Error("storage not allowed");
          return new Promise((resolve, reject) => {
            const reqId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const onMsg = (ev: MessageEvent) => {
              const d = ev.data;
              if (!d || d.source !== "combo-x-page-ext-host" || d.reqId !== reqId) return;
              globalThis.removeEventListener("message", onMsg);
              if (d.ok) resolve(d.value);
              else reject(new Error(d.error || "storage get failed"));
            };
            globalThis.addEventListener("message", onMsg);
            post("storage_get", key, { reqId });
            setTimeout(() => {
              globalThis.removeEventListener("message", onMsg);
              reject(new Error("storage get timeout"));
            }, 8000);
          });
        },
        set(key: string, value: unknown) {
          if (!args.allowStorage) throw new Error("storage not allowed");
          post("storage_set", key, value);
        },
        delete(key: string) {
          if (!args.allowStorage) throw new Error("storage not allowed");
          post("storage_delete", key, null);
        },
        list() {
          if (!args.allowStorage) throw new Error("storage not allowed");
          return new Promise((resolve, reject) => {
            const reqId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const onMsg = (ev: MessageEvent) => {
              const d = ev.data;
              if (!d || d.source !== "combo-x-page-ext-host" || d.reqId !== reqId) return;
              globalThis.removeEventListener("message", onMsg);
              if (d.ok) resolve(d.keys);
              else reject(new Error(d.error || "storage list failed"));
            };
            globalThis.addEventListener("message", onMsg);
            post("storage_list", "", { reqId });
            setTimeout(() => {
              globalThis.removeEventListener("message", onMsg);
              reject(new Error("storage list timeout"));
            }, 8000);
          });
        },
      },
      log(msg: unknown) {
        post("log", "__log", { msg: String(msg) });
      },
    };

    // executeScript bypasses page CSP — Function ctor is intentional here
    // eslint-disable-next-line no-new-func
    const fn = new Function("ComboX", `"use strict";\n${args.source}`);
    fn(ComboX);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Reject over-broad match patterns that would inject on nearly every page. */
export function isOverbroadPattern(pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return true;
  if (p === "*" || p === "*://" || p === "*://*") return true;
  if (p === "*://*/*" || p === "https://*/*" || p === "http://*/*") return true;
  return false;
}
