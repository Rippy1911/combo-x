import type { ContentRequest, CropRect, RecordingSession, ScreenshotResult } from "@combo-x/core";
import { stitchTilesVertically } from "@combo-x/core";

const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen/offscreen.html");
const MAX_FULL_PAGE_TILES = 5;

type OffscreenMessage =
  | { type: "START_RECORDING"; streamId: string }
  | { type: "STOP_RECORDING" }
  | { type: "CROP_IMAGE"; dataUrl: string; rect: CropRect; dpr?: number }
  | {
      type: "STITCH_TILES";
      tiles: string[];
      tileCssHeights: number[];
      dpr?: number;
    }
  | { type: "OFFSCREEN_PING" };

type OffscreenResponse = {
  ok: boolean;
  dataUrl?: string;
  error?: string;
  note?: string;
};

let activeRecording: RecordingSession | null = null;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function ensureOffscreenDocument(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [OFFSCREEN_URL],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS],
    justification: "Tab recording, screenshot crop, and tile stitching",
  });
  await sleep(200);
}

async function sendOffscreen<T extends OffscreenResponse>(message: OffscreenMessage): Promise<T> {
  await ensureOffscreenDocument();
  const res = (await chrome.runtime.sendMessage(message)) as T;
  return res;
}

async function runContent(
  request: ContentRequest,
  tabId: number,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const raw = await chrome.tabs.sendMessage(tabId, request);
    if (!raw || typeof raw !== "object") return { ok: false, error: "bad content response" };
    return raw as { ok: boolean; data?: unknown; error?: string };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function captureTabPng(tabId: number): Promise<ScreenshotResult> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId == null) return { ok: false, error: "tab has no window" };
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    if (!dataUrl) return { ok: false, error: "captureVisibleTab returned empty" };
    return { ok: true, dataUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function captureViewport(windowId?: number): Promise<ScreenshotResult> {
  try {
    let winId = windowId;
    if (winId == null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      winId = tab?.windowId;
    }
    if (winId == null) return { ok: false, error: "no window" };
    const dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: "png" });
    if (!dataUrl) return { ok: false, error: "captureVisibleTab returned empty" };
    return { ok: true, dataUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function captureElement(
  tabId: number,
  target: { selector?: string; index?: number },
): Promise<ScreenshotResult> {
  if (target.selector == null && target.index == null) {
    return { ok: false, error: "selector or index required" };
  }

  const rectRes = await runContent(
    {
      op: "element_rect",
      selector: target.selector,
      index: target.index,
    },
    tabId,
  );
  if (!rectRes.ok || !rectRes.data || typeof rectRes.data !== "object") {
    return { ok: false, error: rectRes.error ?? "element_rect failed" };
  }

  const { x, y, width, height, dpr } = rectRes.data as CropRect & { dpr?: number };
  if (width <= 0 || height <= 0) {
    return { ok: false, error: "element has zero size" };
  }

  const shot = await captureTabPng(tabId);
  if (!shot.ok || !shot.dataUrl) return shot;

  const cropped = await sendOffscreen<OffscreenResponse>({
    type: "CROP_IMAGE",
    dataUrl: shot.dataUrl,
    rect: { x, y, width, height },
    dpr: dpr ?? 1,
  });
  if (!cropped.ok || !cropped.dataUrl) {
    return { ok: false, error: cropped.error ?? "crop failed" };
  }
  return { ok: true, dataUrl: cropped.dataUrl };
}

export async function captureFullPage(tabId: number): Promise<ScreenshotResult> {
  const metricsRes = await runContent({ op: "page_metrics" }, tabId);
  if (!metricsRes.ok || !metricsRes.data || typeof metricsRes.data !== "object") {
    const fallback = await captureViewport();
    return {
      ...fallback,
      note: metricsRes.error ?? "page_metrics unavailable; viewport only",
    };
  }

  const metrics = metricsRes.data as {
    scrollHeight: number;
    clientHeight: number;
    dpr?: number;
  };
  const viewportH = Math.max(1, metrics.clientHeight);
  const pageH = Math.max(viewportH, metrics.scrollHeight);
  const dpr = metrics.dpr ?? 1;

  if (pageH <= viewportH * 1.05) {
    return captureViewport();
  }

  const tileCount = Math.min(MAX_FULL_PAGE_TILES, Math.ceil(pageH / viewportH));
  const tiles: string[] = [];
  const tileHeights: number[] = [];
  const scrollPositions: number[] = [];

  for (let i = 0; i < tileCount; i += 1) {
    const maxScroll = Math.max(0, pageH - viewportH);
    const y = tileCount === 1 ? 0 : Math.round((maxScroll * i) / (tileCount - 1));
    scrollPositions.push(y);
  }

  const originalScroll = await runContent({ op: "page_metrics" }, tabId);
  const startY =
    originalScroll.ok && originalScroll.data && typeof originalScroll.data === "object"
      ? Number((originalScroll.data as { scrollY?: number }).scrollY ?? 0)
      : 0;

  try {
    for (let tileIndex = 0; tileIndex < scrollPositions.length; tileIndex += 1) {
      const y = scrollPositions[tileIndex]!;
      const scrollRes = await runContent(
        { op: "scroll", direction: "percent", percent: (y / Math.max(1, pageH - viewportH)) * 100 },
        tabId,
      );
      if (!scrollRes.ok) {
        const direct = await runContent({ op: "scroll", direction: "top" }, tabId);
        if (!direct.ok) break;
        for (let step = 0; step < tileIndex; step += 1) {
          await runContent({ op: "scroll", direction: "down" }, tabId);
        }
      }
      await sleep(180);
      const shot = await captureTabPng(tabId);
      if (!shot.ok || !shot.dataUrl) {
        const fallback = await captureViewport();
        return {
          ...fallback,
          note: shot.error ?? "tile capture failed; viewport only",
        };
      }
      tiles.push(shot.dataUrl);
      tileHeights.push(viewportH);
    }
  } finally {
    await runContent({ op: "scroll", direction: "top" }, tabId);
    if (startY > 0) {
      await runContent(
        {
          op: "scroll",
          direction: "percent",
          percent: (startY / Math.max(1, pageH - viewportH)) * 100,
        },
        tabId,
      );
    }
  }

  if (tiles.length === 0) {
    const fallback = await captureViewport();
    return { ...fallback, note: "no tiles captured; viewport only" };
  }

  if (tiles.length === 1) {
    return { ok: true, dataUrl: tiles[0] };
  }

  const stitchedOffscreen = await sendOffscreen<OffscreenResponse>({
    type: "STITCH_TILES",
    tiles,
    tileCssHeights: tileHeights,
    dpr,
  });
  if (stitchedOffscreen.ok && stitchedOffscreen.dataUrl) {
    const truncated = tileCount < Math.ceil(pageH / viewportH);
    return {
      ok: true,
      dataUrl: stitchedOffscreen.dataUrl,
      note: truncated
        ? `stitched ${tiles.length}/${Math.ceil(pageH / viewportH)} tiles (max ${MAX_FULL_PAGE_TILES})`
        : `stitched ${tiles.length} tiles`,
    };
  }

  const stitched = await stitchTilesVertically(tiles, tileHeights, dpr);
  if (stitched.ok && stitched.dataUrl) return stitched;

  const fallback = await captureViewport();
  return {
    ...fallback,
    note: stitched.error ?? stitched.note ?? "stitch failed; viewport only",
  };
}

async function getTabMediaStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err?.message) {
        reject(new Error(err.message));
        return;
      }
      if (!streamId) {
        reject(new Error("tabCapture returned empty stream id"));
        return;
      }
      resolve(streamId);
    });
  });
}

export async function startRecording(
  tabId: number,
): Promise<{ ok: boolean; session?: RecordingSession; error?: string }> {
  if (activeRecording) {
    return { ok: false, error: `recording already active (${activeRecording.id})` };
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
    const streamId = await getTabMediaStreamId(tabId);
    const started = await sendOffscreen<OffscreenResponse>({
      type: "START_RECORDING",
      streamId,
    });
    if (!started.ok) return { ok: false, error: started.error ?? "offscreen start failed" };

    const session: RecordingSession = {
      id: crypto.randomUUID(),
      tabId,
      startedAt: new Date().toISOString(),
    };
    activeRecording = session;
    return { ok: true, session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopRecording(opts?: {
  download?: boolean;
  filename?: string;
}): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (!activeRecording) return { ok: false, error: "no active recording" };

  try {
    const stopped = await sendOffscreen<OffscreenResponse>({ type: "STOP_RECORDING" });
    activeRecording = null;
    if (!stopped.ok || !stopped.dataUrl) {
      return { ok: false, error: stopped.error ?? "stop recording failed" };
    }

    if (opts?.download !== false) {
      const name = opts?.filename ?? `combo-x-recording-${Date.now()}.webm`;
      await chrome.downloads.download({ url: stopped.dataUrl, filename: name, saveAs: false });
    }

    return { ok: true, dataUrl: stopped.dataUrl };
  } catch (error) {
    activeRecording = null;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getActiveRecording(): RecordingSession | null {
  return activeRecording;
}
