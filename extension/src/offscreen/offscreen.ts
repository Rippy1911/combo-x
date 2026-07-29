import type { CropRect } from "@combo-x/core";
import { ComboVoiceRuntime, type ComboVoiceEvent } from "./comboVoice.js";

type SpeechLocale = "pl-PL" | "en-US";
type AzureSpeechConfig = {
  key: string;
  region: string;
  locale: SpeechLocale;
  voice?: string;
};

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
  | { type: "OFFSCREEN_PING" }
  | { type: "JARVIS_START"; locale: SpeechLocale; azure: AzureSpeechConfig }
  | { type: "JARVIS_STOP" }
  | { type: "JARVIS_SPEAK"; text: string }
  | { type: "JARVIS_STATUS" }
  | { type: "JARVIS_MIC_CHECK" }
  | { type: "JARVIS_SET_DEBUG"; enabled: boolean }
  | { type: "JARVIS_DRAIN_UTTERANCES" };

type OffscreenResponse = {
  ok: boolean;
  dataUrl?: string;
  error?: string;
  note?: string;
  ready?: boolean;
  status?: ReturnType<ComboVoiceRuntime["status"]>;
  granted?: boolean;
  utterances?: Array<{ text: string; wakeToken: string; at: number }>;
};

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let activeStream: MediaStream | null = null;

const comboVoice = new ComboVoiceRuntime();

comboVoice.onEvent = (event: ComboVoiceEvent) => {
  try {
    void chrome.runtime.sendMessage({ type: "jarvis_offscreen_event", event });
  } catch {
    /* SW may be asleep; next poll will catch up */
  }
};

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


/** COMBO_VOICE_* aliases map to the same handlers as JARVIS_* (MV3 offscreen protocol). */
const COMBO_VOICE_TYPE_ALIASES: Record<string, OffscreenRequest["type"]> = {
  COMBO_VOICE_START: "JARVIS_START",
  COMBO_VOICE_STOP: "JARVIS_STOP",
  COMBO_VOICE_SPEAK: "JARVIS_SPEAK",
  COMBO_VOICE_STATUS: "JARVIS_STATUS",
  COMBO_VOICE_MIC_CHECK: "JARVIS_MIC_CHECK",
  COMBO_VOICE_SET_DEBUG: "JARVIS_SET_DEBUG",
  COMBO_VOICE_DRAIN_UTTERANCES: "JARVIS_DRAIN_UTTERANCES",
};

function resolveOffscreenVoiceType(type: string): OffscreenRequest["type"] | undefined {
  const mapped = COMBO_VOICE_TYPE_ALIASES[type];
  if (mapped) return mapped;
  return OFFSCREEN_TYPES.has(type) ? (type as OffscreenRequest["type"]) : undefined;
}

const OFFSCREEN_TYPES = new Set([
  "OFFSCREEN_PING",
  "START_RECORDING",
  "STOP_RECORDING",
  "CROP_IMAGE",
  "STITCH_TILES",
  "JARVIS_START",
  "JARVIS_STOP",
  "JARVIS_SPEAK",
  "JARVIS_STATUS",
  "JARVIS_MIC_CHECK",
  "JARVIS_SET_DEBUG",
  "JARVIS_DRAIN_UTTERANCES",
]);

chrome.runtime.onMessage.addListener((raw: OffscreenRequest, _sender, sendResponse) => {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return false;
  const resolvedType = resolveOffscreenVoiceType(String(raw.type));
  if (!resolvedType) return false;
  const message =
    resolvedType === raw.type ? raw : ({ ...raw, type: resolvedType } as OffscreenRequest);

  void (async () => {
    let res: OffscreenResponse;
    try {
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
        case "JARVIS_START": {
          const status = await comboVoice.start(message.locale, message.azure);
          res = {
            ok: status.state !== "error",
            status,
            error: status.lastError ?? undefined,
          };
          break;
        }
        case "JARVIS_STOP": {
          const status = await comboVoice.stop();
          res = { ok: true, status };
          break;
        }
        case "JARVIS_SPEAK": {
          const spoken = await comboVoice.speak(message.text);
          res = { ok: spoken.ok, error: spoken.error, status: comboVoice.status() };
          break;
        }
        case "JARVIS_STATUS":
          res = { ok: true, status: comboVoice.status() };
          break;
        case "JARVIS_MIC_CHECK": {
          const granted = await comboVoice.micCheck();
          const status = comboVoice.status();
          res = {
            ok: granted,
            granted,
            error: granted ? undefined : status.lastError ?? "Microphone not granted",
            status,
          };
          break;
        }
        case "JARVIS_SET_DEBUG": {
          comboVoice.setDebug(Boolean(message.enabled));
          res = { ok: true, status: comboVoice.status() };
          break;
        }
        case "JARVIS_DRAIN_UTTERANCES": {
          res = { ok: true, utterances: comboVoice.drainUtterances(), status: comboVoice.status() };
          break;
        }
        default:
          res = { ok: false, error: "unknown offscreen message" };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res = { ok: false, error: msg, status: comboVoice.status() };
    }
    sendResponse(res);
  })();

  return true;
});
