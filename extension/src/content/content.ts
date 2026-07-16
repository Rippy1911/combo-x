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
