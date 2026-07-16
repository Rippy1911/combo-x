import {
  ContentRequestSchema,
  ContentResponseSchema,
  RuntimeMessageSchema,
  type ContentRequest,
  type ContentResponse,
} from "@combo-x/core";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse> {
  const id = tabId ?? (await activeTabId());
  if (id == null) return { ok: false, error: "no active tab" };
  try {
    const raw = await chrome.tabs.sendMessage(id, request);
    const parsed = ContentResponseSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "bad content response" };
    return parsed.data;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `${msg} — reload the tab so the Combo-X content script can inject`,
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      case "content": {
        const req = ContentRequestSchema.parse(parsed.data.request);
        sendResponse(await runContent(req, parsed.data.tabId));
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown" });
    }
  })();

  return true;
});
