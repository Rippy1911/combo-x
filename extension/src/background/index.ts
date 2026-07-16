import {
  ArtifactStore,
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

function contentScriptFiles(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  return scripts.flatMap((s) => s.js ?? []);
}

async function reinjectContent(tabId: number): Promise<void> {
  const files = contentScriptFiles();
  if (files.length === 0) return;
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse> {
  const id = tabId ?? (await activeTabId());
  if (id == null) return { ok: false, error: "no active tab" };

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
  if (!res.ok && /Receiving end does not exist/i.test(res.error ?? "")) {
    try {
      await reinjectContent(id);
      await new Promise((r) => setTimeout(r, 300));
      res = await trySend();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res = { ok: false, error: msg };
    }
    if (!res.ok) {
      res = {
        ok: false,
        error: `${res.error} — reload the tab so the Combo-X content script can inject`,
      };
    }
  }
  return res;
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
      case "open_tab": {
        try {
          const tab = await chrome.tabs.create({
            url: parsed.data.url,
            active: parsed.data.active ?? true,
          });
          sendResponse({
            ok: true,
            data: { id: tab.id!, url: tab.url ?? parsed.data.url },
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
      case "download_text": {
        try {
          const mime = parsed.data.mime ?? "text/plain";
          const blob = new Blob([parsed.data.text], { type: mime });
          const url = URL.createObjectURL(blob);
          await chrome.downloads.download({
            url,
            filename: parsed.data.filename,
            saveAs: true,
          });
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
      default:
        sendResponse({ ok: false, error: "unknown" });
    }
  })();

  return true;
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
