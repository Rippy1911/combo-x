import type { CropRect } from "@combo-x/core";

type OffscreenRequest =
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
  ready?: boolean;
};

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let activeStream: MediaStream | null = null;

function chromeTabConstraints(streamId: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      // Chrome tab-capture extension API
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  };
}

async function startRecording(streamId: string): Promise<OffscreenResponse> {
  try {
    await stopRecordingInternal();
    const stream = await navigator.mediaDevices.getUserMedia(chromeTabConstraints(streamId));
    activeStream = stream;
    recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) recordedChunks.push(ev.data);
    };
    mediaRecorder.start(250);
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

async function stopRecordingInternal(): Promise<void> {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      const rec = mediaRecorder!;
      rec.onstop = () => resolve();
      rec.stop();
    });
  } else {
    mediaRecorder = null;
  }
  for (const track of activeStream?.getTracks() ?? []) track.stop();
  activeStream = null;
}

async function stopRecording(): Promise<OffscreenResponse> {
  try {
    if (!mediaRecorder) return { ok: false, error: "no active recording" };
    await stopRecordingInternal();
    if (recordedChunks.length === 0) return { ok: false, error: "no recorded data" };
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type ?? "video/webm" });
    recordedChunks = [];
    const dataUrl = await blobToDataUrl(blob);
    return { ok: true, dataUrl };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

function get2dContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
}

async function cropImage(
  dataUrl: string,
  rect: CropRect,
  dpr = 1,
): Promise<OffscreenResponse> {
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));

  try {
    const img = await loadImage(dataUrl);
    const CanvasCtor =
      typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas : HTMLCanvasElement;
    const canvas =
      CanvasCtor === OffscreenCanvas
        ? new OffscreenCanvas(sw, sh)
        : Object.assign(document.createElement("canvas"), { width: sw, height: sh });
    const ctx = get2dContext(canvas);
    if (!ctx) return { ok: false, error: "2d context unavailable" };
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return { ok: true, dataUrl: await blobToDataUrl(blob) };
    }
    return { ok: true, dataUrl: (canvas as HTMLCanvasElement).toDataURL("image/png") };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

async function stitchTiles(
  tiles: string[],
  tileCssHeights: number[],
  dpr = 1,
): Promise<OffscreenResponse> {
  if (tiles.length === 0) return { ok: false, error: "no tiles" };
  if (tiles.length === 1) return { ok: true, dataUrl: tiles[0] };

  try {
    const images = await Promise.all(tiles.map((t) => loadImage(t)));
    const width = images[0]!.naturalWidth;
    const totalHeight = tileCssHeights.reduce((sum, h) => sum + Math.round(h * dpr), 0);
    const CanvasCtor =
      typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas : HTMLCanvasElement;
    const canvas =
      CanvasCtor === OffscreenCanvas
        ? new OffscreenCanvas(width, Math.max(1, totalHeight))
        : Object.assign(document.createElement("canvas"), {
            width,
            height: Math.max(1, totalHeight),
          });
    const ctx = get2dContext(canvas);
    if (!ctx) return { ok: false, error: "2d context unavailable" };
    let y = 0;
    for (let i = 0; i < images.length; i += 1) {
      const img = images[i]!;
      const h = Math.round((tileCssHeights[i] ?? img.naturalHeight / dpr) * dpr);
      ctx.drawImage(img, 0, 0, width, h, 0, y, width, h);
      y += h;
    }
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return { ok: true, dataUrl: await blobToDataUrl(blob) };
    }
    return { ok: true, dataUrl: (canvas as HTMLCanvasElement).toDataURL("image/png") };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return false;

  void (async () => {
    let res: OffscreenResponse;
    switch (message.type) {
      case "OFFSCREEN_PING":
        res = { ok: true, ready: true };
        break;
      case "START_RECORDING":
        res = await startRecording(message.streamId);
        break;
      case "STOP_RECORDING":
        res = await stopRecording();
        break;
      case "CROP_IMAGE":
        res = await cropImage(message.dataUrl, message.rect, message.dpr);
        break;
      case "STITCH_TILES":
        res = await stitchTiles(message.tiles, message.tileCssHeights, message.dpr);
        break;
      default:
        res = { ok: false, error: "unknown offscreen message" };
    }
    sendResponse(res);
  })();

  return true;
});
