import type { BrowserBridge, ContentRequest, ContentResponse, ScreenshotResult } from "@combo-x/core";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Side-panel bridge → service worker → content script. */
export function createChromeBridge(): BrowserBridge {
  return {
    async runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse> {
      let last: ContentResponse = { ok: false, error: "no attempt" };
      for (let i = 0; i < 4; i += 1) {
        const res = (await chrome.runtime.sendMessage({
          type: "content",
          tabId,
          request,
        })) as ContentResponse;
        last = res;
        if (res.ok) return res;
        const err = res.error ?? "";
        if (!/Receiving end does not exist|content script/i.test(err)) return res;
        await sleep(400 * (i + 1));
      }
      return last;
    },
    async listTabs() {
      const res = (await chrome.runtime.sendMessage({ type: "list_tabs" })) as {
        ok: boolean;
        data?: { tabs: Array<{ id: number; title: string; url: string }> };
      };
      return res.data?.tabs ?? [];
    },
    async openTab(url: string, active = true) {
      const res = (await chrome.runtime.sendMessage({
        type: "open_tab",
        url,
        active,
      })) as { ok: boolean; data?: { id: number; url: string }; error?: string };
      if (!res.ok || !res.data) throw new Error(res.error ?? "open_tab failed");
      await sleep(600);
      return res.data;
    },
    async activateTab(tabId: number) {
      const res = (await chrome.runtime.sendMessage({
        type: "activate_tab",
        tabId,
      })) as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "activate_tab failed");
      await sleep(300);
      return { ok: true };
    },
    async navigate(url: string, tabId?: number) {
      const res = (await chrome.runtime.sendMessage({
        type: "navigate",
        url,
        tabId,
      })) as { ok: boolean; data?: { url: string }; error?: string };
      if (!res.ok) throw new Error(res.error ?? "navigate failed");
      await sleep(600);
      return { ok: true, url: res.data?.url ?? url };
    },
    async goBack(tabId?: number) {
      const res = (await chrome.runtime.sendMessage({
        type: "go_back",
        tabId,
      })) as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "go_back failed");
      await sleep(400);
      return { ok: true };
    },
    async closeTab(tabId: number) {
      const res = (await chrome.runtime.sendMessage({
        type: "close_tab",
        tabId,
      })) as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "close_tab failed");
      return { ok: true };
    },
    async downloadText(filename: string, text: string, mime = "text/plain") {
      const res = (await chrome.runtime.sendMessage({
        type: "download_text",
        filename,
        text,
        mime,
      })) as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "download failed");
      return { ok: true };
    },
    async captureViewport(windowId?: number): Promise<ScreenshotResult> {
      return (await chrome.runtime.sendMessage({
        type: "capture_viewport",
        windowId,
      })) as ScreenshotResult;
    },
    async captureElement(
      tabId: number,
      target: { selector?: string; index?: number },
    ): Promise<ScreenshotResult> {
      return (await chrome.runtime.sendMessage({
        type: "capture_element",
        tabId,
        selector: target.selector,
        index: target.index,
      })) as ScreenshotResult;
    },
    async captureFullPage(tabId: number): Promise<ScreenshotResult> {
      return (await chrome.runtime.sendMessage({
        type: "capture_full_page",
        tabId,
      })) as ScreenshotResult;
    },
    async startRecording(tabId: number) {
      return (await chrome.runtime.sendMessage({
        type: "start_recording",
        tabId,
      })) as {
        ok: boolean;
        session?: { id: string; tabId: number; startedAt: string };
        error?: string;
      };
    },
    async stopRecording(opts?: { download?: boolean; filename?: string }) {
      return (await chrome.runtime.sendMessage({
        type: "stop_recording",
        download: opts?.download,
        filename: opts?.filename,
      })) as { ok: boolean; dataUrl?: string; error?: string };
    },
  };
}
