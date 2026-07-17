import {
  ArtifactStore,
  ContentResponseSchema,
  RuntimeMessageSchema,
  type ContentRequest,
  type ContentResponse,
} from "@combo-x/core";
import {
  captureElement,
  captureFullPage,
  captureViewport,
  startRecording,
  stopRecording,
} from "../lib/media-bridge.js";
import {
  clearTokensForTab,
  handlePageExtBridge,
  injectPageExtensionsForTab,
} from "../lib/page-ext-inject.js";
import {
  formatContentFailure,
  isStaleContentAsset,
  shouldAttemptContentRecovery,
} from "./contentRecovery.js";
import {
  isHistoryNavSettled,
  isNavigationSettled,
  urlsMatchTarget,
} from "./navWait.js";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function contentScriptFiles(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  return scripts.flatMap((s) => s.js ?? []);
}

const STABLE_CONTENT_LOADER = "assets/content-loader.js";

async function reinjectContent(tabId: number): Promise<void> {
  const files = contentScriptFiles();
  const primary = files.length > 0 ? files : [STABLE_CONTENT_LOADER];
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: primary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // After vite rebuild, hashed loader may be gone while stable content-loader.js exists.
    if (
      isStaleContentAsset(msg) &&
      !primary.includes(STABLE_CONTENT_LOADER)
    ) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [STABLE_CONTENT_LOADER],
      });
      return;
    }
    throw e;
  }
}

/**
 * Wait for a load cycle to finish. Requires seeing `loading` first so we never
 * resolve on the previous document's leftover `complete`.
 */
function waitTabComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let sawLoading = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs.get(tabId).then((t) => {
      if (t.status === "loading") sawLoading = true;
    });
    setTimeout(finish, timeoutMs);
  });
}

async function waitForNavigation(
  tabId: number,
  targetUrl: string,
  startUrl: string,
  timeoutMs = 20_000,
): Promise<{ url: string; title: string }> {
  return new Promise((resolve) => {
    let done = false;
    let sawLoading = false;
    let currentUrl = startUrl;

    const finish = async () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      try {
        const t = await chrome.tabs.get(tabId);
        resolve({ url: t.url ?? currentUrl, title: t.title ?? "" });
      } catch {
        resolve({ url: currentUrl, title: "" });
      }
    };

    const maybeSettle = (status: string | undefined, url: string | undefined) => {
      if (url) currentUrl = url;
      if (status === "loading") sawLoading = true;
      if (
        isNavigationSettled({
          startUrl,
          targetUrl,
          currentUrl: url ?? currentUrl,
          status,
          sawLoading,
        })
      ) {
        void finish();
      }
    };

    const onUpdated = (
      id: number,
      info: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId) return;
      maybeSettle(info.status, info.url ?? tab.url);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs.get(tabId).then((t) => {
      maybeSettle(t.status, t.url);
    });
    setTimeout(() => void finish(), timeoutMs);
  });
}

async function waitForHistoryNav(
  tabId: number,
  startUrl: string,
  timeoutMs = 15_000,
): Promise<{ url: string; title: string }> {
  return new Promise((resolve) => {
    let done = false;
    let sawLoading = false;
    let currentUrl = startUrl;

    const finish = async () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      try {
        const t = await chrome.tabs.get(tabId);
        resolve({ url: t.url ?? currentUrl, title: t.title ?? "" });
      } catch {
        resolve({ url: currentUrl, title: "" });
      }
    };

    const onUpdated = (
      id: number,
      info: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId) return;
      if (info.url) currentUrl = info.url;
      else if (tab.url) currentUrl = tab.url;
      if (info.status === "loading") sawLoading = true;
      if (
        isHistoryNavSettled({
          startUrl,
          currentUrl,
          status: info.status,
          sawLoading,
        })
      ) {
        void finish();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(() => void finish(), timeoutMs);
  });
}

/** After document complete: confirm content script reports the new URL. */
async function ensureContentReady(
  tabId: number,
  expectedUrl: string,
  attempts = 6,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  // SPA hydrate / late scripts
  await new Promise((r) => setTimeout(r, 400));
  let lastUrl = "";
  let lastErr = "";
  let reinjected = false;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const raw = await chrome.tabs.sendMessage(tabId, {
        op: "get_page",
        mode: "snippet",
        maxChars: 200,
      });
      const url =
        raw && typeof raw === "object" && raw.ok && raw.data && typeof raw.data === "object"
          ? String((raw.data as { url?: unknown }).url ?? "")
          : "";
      lastUrl = url;
      if (url && urlsMatchTarget(url, expectedUrl)) {
        return { ok: true, url };
      }
      // Content alive on final tab URL (same-host redirect already accepted by urlsMatchTarget).
      if (url && /^https?:/i.test(url)) {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete" && tab.url && urlsMatchTarget(url, tab.url) && urlsMatchTarget(url, expectedUrl)) {
          return { ok: true, url };
        }
      }
      lastErr = url ? `content still on ${url}` : "content missing url";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // Reinject at most once — repeated executeScript stacks onMessage listeners.
      if (!reinjected && shouldAttemptContentRecovery(lastErr)) {
        reinjected = true;
        try {
          await reinjectContent(tabId);
          await new Promise((r) => setTimeout(r, 200));
        } catch (inj) {
          lastErr = inj instanceof Error ? inj.message : String(inj);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return {
    ok: false,
    url: tab?.url ?? lastUrl,
    error: lastErr || "content not ready after navigate",
  };
}

async function runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse> {
  const id = tabId ?? (await activeTabId());
  if (id == null) return { ok: false, error: "no active tab" };

  // If a navigation is mid-flight, wait so we don't scrape the previous document.
  try {
    const tab = await chrome.tabs.get(id);
    if (tab.status === "loading") {
      await waitTabComplete(id, 15_000);
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {
    /* tab gone */
  }

  const trySend = async (): Promise<ContentResponse> => {
    try {
      const raw = await chrome.tabs.sendMessage(id, request);
      const parsed = ContentResponseSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: "bad content response" };
      return parsed.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: msg };
    }
  };

  let res = await trySend();
  if (!res.ok && shouldAttemptContentRecovery(res.error)) {
    // 1) Reinject from current manifest. Stale hashed assets → stop (need extension reload).
    try {
      await reinjectContent(id);
      await new Promise((r) => setTimeout(r, 300));
      res = await trySend();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isStaleContentAsset(msg) || isStaleContentAsset(res.error)) {
        return { ok: false, error: formatContentFailure(msg) };
      }
      res = { ok: false, error: msg };
    }

    if (!res.ok && isStaleContentAsset(res.error)) {
      return { ok: false, error: formatContentFailure(res.error) };
    }

    // 2) One tab reload + reinject (orphaned listener after navigate / soft invalidate).
    if (!res.ok && shouldAttemptContentRecovery(res.error)) {
      try {
        await chrome.tabs.reload(id);
        await waitTabComplete(id);
        await reinjectContent(id);
        await new Promise((r) => setTimeout(r, 300));
        res = await trySend();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res = { ok: false, error: msg };
      }
    }

    if (!res.ok) {
      res = { ok: false, error: formatContentFailure(res.error) };
    }
  }
  return res;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const parsed = RuntimeMessageSchema.safeParse(message);
  if (!parsed.success) {
    sendResponse({ ok: false, error: "invalid runtime message" });
    return true;
  }

  void (async () => {
    switch (parsed.data.type) {
      case "ping":
        sendResponse({ ok: true, data: { pong: true } });
        break;
      case "list_tabs": {
        const tabs = await chrome.tabs.query({});
        sendResponse({
          ok: true,
          data: {
            tabs: tabs
              .filter((t) => t.id != null)
              .map((t) => ({
                id: t.id!,
                title: t.title ?? "",
                url: t.url ?? "",
              })),
          },
        });
        break;
      }
      case "open_tab": {
        try {
          const targetUrl = parsed.data.url;
          const tab = await chrome.tabs.create({
            url: targetUrl,
            active: parsed.data.active ?? true,
          });
          const id = tab.id;
          if (id == null) {
            sendResponse({ ok: false, error: "tab create returned no id" });
            break;
          }
          const settled = await waitForNavigation(id, targetUrl, "chrome://newtab/", 20_000);
          const ready = await ensureContentReady(id, settled.url || targetUrl);
          sendResponse({
            ok: true,
            data: {
              id,
              url: ready.url ?? settled.url,
              title: settled.title,
              contentReady: ready.ok,
              ...(ready.ok ? {} : { warning: ready.error }),
            },
          });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "activate_tab": {
        try {
          await chrome.tabs.update(parsed.data.tabId, { active: true });
          const tab = await chrome.tabs.get(parsed.data.tabId);
          if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "navigate": {
        try {
          const id = parsed.data.tabId ?? (await activeTabId());
          if (id == null) {
            sendResponse({ ok: false, error: "no active tab" });
            break;
          }
          const targetUrl = parsed.data.url;
          const before = await chrome.tabs.get(id);
          const startUrl = before.url ?? "";
          await chrome.tabs.update(id, { url: targetUrl });
          const settled = await waitForNavigation(id, targetUrl, startUrl, 20_000);
          const ready = await ensureContentReady(id, settled.url || targetUrl);
          sendResponse({
            ok: true,
            data: {
              url: ready.url ?? settled.url,
              title: settled.title,
              previousUrl: startUrl,
              contentReady: ready.ok,
              ...(ready.ok ? {} : { warning: ready.error }),
            },
          });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "go_back": {
        try {
          const id = parsed.data.tabId ?? (await activeTabId());
          if (id == null) {
            sendResponse({ ok: false, error: "no active tab" });
            break;
          }
          const before = await chrome.tabs.get(id);
          const startUrl = before.url ?? "";
          await chrome.tabs.goBack(id);
          const settled = await waitForHistoryNav(id, startUrl, 15_000);
          const ready = await ensureContentReady(id, settled.url || startUrl);
          sendResponse({
            ok: true,
            data: {
              url: ready.url ?? settled.url,
              title: settled.title,
              contentReady: ready.ok,
              ...(ready.ok ? {} : { warning: ready.error }),
            },
          });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "close_tab": {
        try {
          await chrome.tabs.remove(parsed.data.tabId);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "download_text": {
        try {
          const { toDownloadDataUrl, DOWNLOAD_DATA_URL_SOFT_MAX } = await import(
            "../lib/downloadDataUrl.js"
          );
          const mime = parsed.data.mime ?? "text/plain";
          const text = parsed.data.text;
          const url = toDownloadDataUrl(text, mime);
          if (url.length > DOWNLOAD_DATA_URL_SOFT_MAX) {
            sendResponse({
              ok: false,
              error: `download too large for data URL (${url.length} chars; max ~${DOWNLOAD_DATA_URL_SOFT_MAX}). Use Open tab on the in-chat preview instead.`,
            });
            break;
          }
          await chrome.downloads.download({
            url,
            filename: parsed.data.filename,
            saveAs: true,
          });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "content": {
        sendResponse(await runContent(parsed.data.request, parsed.data.tabId));
        break;
      }
      case "capture_viewport": {
        sendResponse(await captureViewport(parsed.data.windowId));
        break;
      }
      case "capture_element": {
        if (parsed.data.selector == null && parsed.data.index == null) {
          sendResponse({ ok: false, error: "selector or index required" });
          break;
        }
        sendResponse(
          await captureElement(parsed.data.tabId, {
            selector: parsed.data.selector,
            index: parsed.data.index,
          }),
        );
        break;
      }
      case "capture_full_page": {
        sendResponse(await captureFullPage(parsed.data.tabId));
        break;
      }
      case "start_recording": {
        sendResponse(await startRecording(parsed.data.tabId));
        break;
      }
      case "stop_recording": {
        sendResponse(
          await stopRecording({
            download: parsed.data.download,
            filename: parsed.data.filename,
          }),
        );
        break;
      }
      case "inject_page_extensions": {
        const tabId = parsed.data.tabId ?? (await activeTabId());
        if (tabId == null) {
          sendResponse({ ok: false, error: "no active tab" });
          break;
        }
        sendResponse(
          await injectPageExtensionsForTab({
            tabId,
            scriptIds: parsed.data.scriptIds,
          }),
        );
        break;
      }
      case "page_ext_bridge": {
        if (!sender.tab?.id) {
          sendResponse({ ok: false, error: "bridge requires tab sender" });
          break;
        }
        sendResponse(
          await handlePageExtBridge({
            kind: parsed.data.kind,
            scriptId: parsed.data.scriptId,
            bridgeToken: parsed.data.bridgeToken,
            channel: parsed.data.channel,
            payload: parsed.data.payload,
            reqId: parsed.data.reqId,
            pageUrl: parsed.data.pageUrl,
            tabId: parsed.data.tabId ?? sender.tab.id,
          }),
        );
        break;
      }
      case "preview_frame": {
        const tabId = parsed.data.tabId ?? (await activeTabId());
        if (tabId == null) {
          sendResponse({ ok: false, error: "no active tab" });
          break;
        }
        try {
          const tab = await chrome.tabs.get(tabId);
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, {
            format: "jpeg",
            quality: 72,
          });
          sendResponse({
            ok: true,
            dataUrl,
            tabId,
            url: tab.url ?? "",
            title: tab.title ?? "",
          });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown" });
    }
  })();

  return true;
});

/** Auto-inject only extensions with autoInject=true on navigation. */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
  void injectPageExtensionsForTab({ tabId, autoOnly: true }).catch(() => {
    /* ignore */
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTokensForTab(tabId);
});

const artifacts = new ArtifactStore();

async function fireDueReminders(): Promise<void> {
  try {
    const due = await artifacts.dueReminders();
    for (const r of due) {
      await chrome.notifications.create(`combo-x-rem-${r.id}`, {
        type: "basic",
        iconUrl: "public/icon-128.png",
        title: "Combo-X reminder",
        message: r.text.slice(0, 180),
      });
      await artifacts.markReminderFired(r.id);
    }
  } catch {
    /* IDB / notifications may be unavailable in some contexts */
  }
}

chrome.alarms.create("combo-x-reminders", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "combo-x-reminders") return;
  void fireDueReminders();
});
void fireDueReminders();
