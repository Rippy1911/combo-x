import { ContentRequestSchema, handleContentRequest, waitMs } from "@combo-x/core";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const parsed = ContentRequestSchema.safeParse(message);
  if (!parsed.success) {
    sendResponse({ ok: false, error: "invalid content request" });
    return true;
  }
  void (async () => {
    if (parsed.data.op === "wait") {
      await waitMs(parsed.data.ms);
      sendResponse({ ok: true, data: { waitedMs: parsed.data.ms } });
      return;
    }
    sendResponse(handleContentRequest(parsed.data, document));
  })();
  return true;
});

/**
 * Page extensions run in MAIN world and talk only via window.postMessage.
 * This isolated content script is the sole chrome.runtime speaker — pages never get chrome.*.
 */
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const d = ev.data;
  if (!d || d.source !== "combo-x-page-ext" || typeof d.scriptId !== "string") return;
  const kind = d.kind as string;
  if (
    kind !== "export" &&
    kind !== "storage_get" &&
    kind !== "storage_set" &&
    kind !== "storage_delete" &&
    kind !== "storage_list" &&
    kind !== "log"
  ) {
    return;
  }

  const reqId =
    d.payload && typeof d.payload === "object" && d.payload !== null && "reqId" in d.payload
      ? String((d.payload as { reqId?: unknown }).reqId ?? "")
      : undefined;

  void chrome.runtime
    .sendMessage({
      type: "page_ext_bridge",
      kind,
      scriptId: d.scriptId,
      channel: String(d.channel ?? ""),
      payload: d.payload,
      reqId,
      pageUrl: location.href,
    })
    .then((res: { ok?: boolean; value?: unknown; keys?: unknown; error?: string; reqId?: string }) => {
      if (kind !== "storage_get" && kind !== "storage_list") return;
      window.postMessage(
        {
          source: "combo-x-page-ext-host",
          reqId: res?.reqId ?? reqId,
          ok: !!res?.ok,
          value: res?.value,
          keys: res?.keys,
          error: res?.error,
        },
        location.origin,
      );
    })
    .catch((e: unknown) => {
      if (kind !== "storage_get" && kind !== "storage_list") return;
      window.postMessage(
        {
          source: "combo-x-page-ext-host",
          reqId,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        },
        location.origin,
      );
    });
});
