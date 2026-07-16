import { ContentRequestSchema, handleContentRequest } from "@combo-x/core";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const parsed = ContentRequestSchema.safeParse(message);
  if (!parsed.success) {
    sendResponse({ ok: false, error: "invalid content request" });
    return true;
  }
  const result = handleContentRequest(parsed.data, document);
  sendResponse(result);
  return true;
});
