import {
  PageExtensionStore,
  runPageExtensionInMainWorld,
  urlMatches,
  type PageExtension,
} from "@combo-x/core";

function bridgeAllowed(
  ext: PageExtension,
  pageUrl: string | undefined,
): { ok: true } | { ok: false; error: string } {
  if (ext.approval !== "approved") return { ok: false, error: "extension not approved" };
  if (!ext.enabled) return { ok: false, error: "extension disabled" };
  if (!pageUrl || !urlMatches(pageUrl, ext.match)) {
    return { ok: false, error: "url does not match extension patterns" };
  }
  if (!ext.bridge) return { ok: false, error: "no bridge configured" };
  return { ok: true };
}

const store = new PageExtensionStore();

function payloadBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function injectPageExtensionsForTab(opts: {
  tabId: number;
  scriptIds?: string[];
}): Promise<{ ok: boolean; injected: string[]; errors: string[] }> {
  const tab = await chrome.tabs.get(opts.tabId);
  const url = tab.url ?? "";
  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    return { ok: false, injected: [], errors: ["unsupported url"] };
  }

  let targets: PageExtension[] = [];
  if (opts.scriptIds?.length) {
    for (const id of opts.scriptIds) {
      const row = await store.get(id);
      if (row) targets.push(row);
    }
  } else {
    targets = await store.listInjectableForUrl(url);
  }

  const injected: string[] = [];
  const errors: string[] = [];

  for (const ext of targets) {
    if (ext.approval !== "approved" || !ext.enabled) {
      errors.push(`${ext.id}: not approved/enabled`);
      continue;
    }
    if (!urlMatches(url, ext.match)) {
      errors.push(`${ext.id}: url mismatch`);
      continue;
    }
    try {
      const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
        target: { tabId: opts.tabId },
        world: "MAIN",
        func: runPageExtensionInMainWorld,
        args: [
          {
            scriptId: ext.id,
            name: ext.name,
            source: ext.source,
            exportChannels: ext.bridge?.exportChannels ?? [],
            allowStorage: !!ext.bridge?.allowStorage,
          },
        ],
      });
      const r = result as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok === false) {
        errors.push(`${ext.id}: ${r.error ?? "inject failed"}`);
      } else {
        injected.push(ext.id);
        await store.markInjected(ext.id, url, opts.tabId);
      }
    } catch (e) {
      errors.push(`${ext.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: errors.length === 0 || injected.length > 0, injected, errors };
}

export async function handlePageExtBridge(msg: {
  kind: "export" | "storage_get" | "storage_set" | "storage_delete" | "storage_list" | "log";
  scriptId: string;
  channel: string;
  payload?: unknown;
  reqId?: string;
  pageUrl?: string;
  tabId?: number;
}): Promise<{
  ok: boolean;
  value?: unknown;
  keys?: unknown;
  error?: string;
  reqId?: string;
}> {
  const ext = await store.get(msg.scriptId);
  if (!ext) return { ok: false, error: "unknown extension", reqId: msg.reqId };
  const gate = bridgeAllowed(ext, msg.pageUrl);
  if (!gate.ok) return { ok: false, error: gate.error, reqId: msg.reqId };
  const bridge = ext.bridge!;
  const max = bridge.maxPayloadBytes ?? 64_000;

  if (msg.kind === "log") {
    await store.audit({
      extensionId: msg.scriptId,
      action: "export",
      actor: "page",
      pageUrl: msg.pageUrl,
      tabId: msg.tabId,
      detail: { channel: "__log", msg: (msg.payload as { msg?: string })?.msg },
    });
    return { ok: true, reqId: msg.reqId };
  }

  if (msg.kind === "export") {
    if (!bridge.exportChannels.includes(msg.channel)) {
      return { ok: false, error: "export channel not allowed", reqId: msg.reqId };
    }
    if (payloadBytes(msg.payload) > max) {
      return { ok: false, error: "payload too large", reqId: msg.reqId };
    }
    await store.dataSet(msg.scriptId, `export:${msg.channel}`, msg.payload, {
      actor: "page",
      pageUrl: msg.pageUrl,
      tabId: msg.tabId,
    });
    await store.recordExport(msg.scriptId, msg.channel, msg.pageUrl, msg.tabId);
    return { ok: true, reqId: msg.reqId };
  }

  if (!bridge.allowStorage) {
    return { ok: false, error: "storage not allowed", reqId: msg.reqId };
  }

  if (msg.kind === "storage_get") {
    const value = await store.dataGet(msg.scriptId, msg.channel);
    return { ok: true, value, reqId: msg.reqId };
  }
  if (msg.kind === "storage_list") {
    const keys = await store.dataList(msg.scriptId);
    return { ok: true, keys: keys.map((k) => k.key), reqId: msg.reqId };
  }
  if (msg.kind === "storage_set") {
    if (payloadBytes(msg.payload) > max) {
      return { ok: false, error: "payload too large", reqId: msg.reqId };
    }
    await store.dataSet(msg.scriptId, msg.channel, msg.payload, {
      actor: "page",
      pageUrl: msg.pageUrl,
      tabId: msg.tabId,
    });
    return { ok: true, reqId: msg.reqId };
  }
  if (msg.kind === "storage_delete") {
    await store.dataDelete(msg.scriptId, msg.channel, {
      actor: "page",
      pageUrl: msg.pageUrl,
      tabId: msg.tabId,
    });
    return { ok: true, reqId: msg.reqId };
  }

  return { ok: false, error: "unknown kind", reqId: msg.reqId };
}
