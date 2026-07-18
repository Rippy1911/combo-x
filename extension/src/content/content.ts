import { ContentRequestSchema, handleContentRequest, waitMs } from "@combo-x/core";
import { startElementPicker, stopElementPicker } from "./elementPicker";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if ((message as { type?: string }).type === "combo_x_picker") {
    const action = (message as { action?: string }).action;
    if (action === "stop") {
      stopElementPicker();
      sendResponse({ ok: true, cancelled: true });
      return true;
    }
    if (action === "start") {
      startElementPicker((result) => sendResponse(result));
      return true;
    }
    sendResponse({ ok: false, error: "unknown picker action" });
    return true;
  }

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
 * bridgeToken is required — forgeable scriptId alone is rejected by the SW.
 */
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const d = ev.data;
  if (!d || d.source !== "combo-x-page-ext" || typeof d.scriptId !== "string") return;
  if (typeof d.bridgeToken !== "string" || !d.bridgeToken) return;
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
      bridgeToken: d.bridgeToken,
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
