import type { BrowserBridge, ContentRequest, ContentResponse } from "@combo-x/core";

/** Side-panel bridge → service worker → content script. */
export function createChromeBridge(): BrowserBridge {
  return {
    async runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse> {
      const res = await chrome.runtime.sendMessage({
        type: "content",
        tabId,
        request,
      });
      return res as ContentResponse;
    },
    async listTabs() {
      const res = (await chrome.runtime.sendMessage({ type: "list_tabs" })) as {
        ok: boolean;
        data?: { tabs: Array<{ id: number; title: string; url: string }> };
      };
      return res.data?.tabs ?? [];
    },
  };
}
