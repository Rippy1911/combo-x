import {
  WakeWordDetector,
  UtteranceEndpointer,
  encodeWav16,
  concatFloat32,
  downsampleTo16k,
  transcribeWav,
  synthesizeSpeech,
  parseWakeUtterance,
  mintWakeToken,
  type SpeechLocale,
  type AzureSpeechConfig,
  type OrtSessionLike,
} from "@combo-x/core";

type OrtModule = typeof import("onnxruntime-web/wasm");
let ortMod: OrtModule | null = null;

async function loadOrt(): Promise<OrtModule> {
  if (ortMod) return ortMod;
  ortMod = await import("onnxruntime-web/wasm");
  return ortMod;
}

export type JarvisVoiceState =
  | "off"
  | "loading"
  | "listening"
  | "armed"
  | "thinking"
  | "speaking"
  | "error";

export interface JarvisVoiceStatus {
  state: JarvisVoiceState;
  micGranted: boolean;
  lastTranscript: string | null;
  lastError: string | null;
  locale: SpeechLocale;
  micOwner: "offscreen" | "daemon";
}

export interface JarvisVoiceUtterance {
  text: string;
  wakeToken: string;
  at: number;
}

export type JarvisVoiceEvent =
  | { type: "status"; status: JarvisVoiceStatus }
  | { type: "utterance"; utterance: JarvisVoiceUtterance };

export interface DetectorLike {
  load(): Promise<void>;
  push(samples: Float32Array): Promise<{ label: string; score: number; at: number } | null>;
  reset(): void;
  readonly ready: boolean;
}

export interface EndpointerLike {
  push(
    frame: Float32Array,
    speechProb?: number,
  ):
    | { type: "speech_start"; at: number }
    | { type: "speech_end"; at: number; reason: "silence" | "max_duration" | "no_speech" }
    | null;
  reset(): void;
  readonly speaking: boolean;
}

export interface JarvisVoiceDeps {
  createDetector?: (opts: {
    modelBaseUrl: string;
    createSession: (modelUrl: string) => Promise<unknown>;
    makeTensor: (data: Float32Array, dims: readonly number[]) => unknown;
  }) => DetectorLike;
  createEndpointer?: () => EndpointerLike;
  transcribeWav?: typeof transcribeWav;
  synthesizeSpeech?: typeof synthesizeSpeech;
  mintWakeToken?: typeof mintWakeToken;
  parseWakeUtterance?: typeof parseWakeUtterance;
  encodeWav16?: typeof encodeWav16;
  concatFloat32?: typeof concatFloat32;
  downsampleTo16k?: typeof downsampleTo16k;
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  AudioContextCtor?: typeof AudioContext;
  now?: () => number;
  /** Tests: skip real mic; drive via ingestFrame(). */
  skipMic?: boolean;
  playAudio?: (buf: ArrayBuffer, mime?: string) => Promise<void>;
}

const CAPTURE_FRAME = 1024;
const ARMED_MAX_MS = 20_000;

const WORKLET_SOURCE = `
class JarvisCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(0);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    const merged = new Float32Array(this._buf.length + ch.length);
    merged.set(this._buf);
    merged.set(ch, this._buf.length);
    let offset = 0;
    while (merged.length - offset >= ${CAPTURE_FRAME}) {
      this.port.postMessage(merged.slice(offset, offset + ${CAPTURE_FRAME}));
      offset += ${CAPTURE_FRAME};
    }
    this._buf = merged.slice(offset);
    return true;
  }
}
registerProcessor("jarvis-capture", JarvisCaptureProcessor);
`;

function defaultPlayAudio(buf: ArrayBuffer, mime = "audio/mpeg"): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const cleanup = () => {
      URL.revokeObjectURL(url);
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("audio playback failed"));
    };
    void audio.play().catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export class JarvisVoiceRuntime {
  onEvent: ((ev: JarvisVoiceEvent) => void) | null = null;

  private state: JarvisVoiceState = "off";
  private locale: SpeechLocale = "pl-PL";
  private azure: AzureSpeechConfig | null = null;
  private micGranted = false;
  private lastTranscript: string | null = null;
  private lastError: string | null = null;
  private wakeToken: string | null = null;
  private armedAt = 0;
  private armedFrames: Float32Array[] = [];
  private detectionSuspended = false;
  private processing = false;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private captureBuf = new Float32Array(0);
  private detector: DetectorLike | null = null;
  private endpointer: EndpointerLike | null = null;
  private readonly deps: JarvisVoiceDeps;
  private readonly now: () => number;

  constructor(deps: JarvisVoiceDeps = {}) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  status(): JarvisVoiceStatus {
    return {
      state: this.state,
      micGranted: this.micGranted,
      lastTranscript: this.lastTranscript,
      lastError: this.lastError,
      locale: this.locale,
      micOwner: "offscreen",
    };
  }

  async start(locale: SpeechLocale, azure: AzureSpeechConfig | null | undefined): Promise<JarvisVoiceStatus> {
    try {
      if (!azure?.key?.trim()) {
        this.setError("azure_speech_key missing in vault");
        return this.status();
      }
      this.azure = {
        key: azure.key,
        region: azure.region,
        locale: azure.locale ?? locale,
        voice: azure.voice,
      };
      this.locale = locale;
      this.lastError = null;
      this.setState("loading");

      this.detector = await this.buildDetector();
      await this.detector.load();
      this.endpointer = this.buildEndpointer();
      this.endpointer.reset();

      if (!this.deps.skipMic) {
        await this.startMic();
      } else {
        this.micGranted = true;
      }

      this.wakeToken = null;
      this.armedFrames = [];
      this.detectionSuspended = false;
      this.setState("listening");
      return this.status();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError(msg);
      return this.status();
    }
  }

  async stop(): Promise<JarvisVoiceStatus> {
    this.teardownMic();
    this.detector = null;
    this.endpointer = null;
    this.wakeToken = null;
    this.armedFrames = [];
    this.azure = null;
    this.detectionSuspended = false;
    this.processing = false;
    this.setState("off");
    return this.status();
  }

  async speak(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.azure?.key) {
      return { ok: false, error: "azure_speech_key missing in vault" };
    }
    const synth = this.deps.synthesizeSpeech ?? synthesizeSpeech;
    const play = this.deps.playAudio ?? defaultPlayAudio;
    const wasOff = this.state === "off";
    this.detectionSuspended = true;
    this.setState("speaking");
    try {
      const res = await synth(text, this.azure);
      if (!res.ok || !res.audio) {
        const error = res.error ?? "synthesize failed";
        this.setTransientError(error);
        return { ok: false, error };
      }
      await play(res.audio, res.mime);
      this.detectionSuspended = false;
      if (this.state === "speaking") {
        this.setState(wasOff || !this.detector ? "off" : "listening");
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A TTS failure must not deafen the wake loop either.
      this.setTransientError(msg);
      return { ok: false, error: msg };
    }
  }

  async micCheck(): Promise<boolean> {
    try {
      const gum =
        this.deps.getUserMedia ??
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const stream = await gum({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      this.micGranted = true;
      this.emitStatus();
      return true;
    } catch {
      this.micGranted = false;
      this.emitStatus();
      return false;
    }
  }

  /** Feed 16 kHz mono PCM (tests + mic path). */
  async ingestFrame(samples16k: Float32Array): Promise<void> {
    if (this.state === "off" || this.state === "loading" || this.state === "error") return;
    if (this.detectionSuspended || this.processing) return;
    if (!this.detector || !this.endpointer) return;

    if (this.state === "listening") {
      // Privacy: discard ambient audio beyond the detector's internal window.
      const hit = await this.detector.push(samples16k);
      if (!hit) return;
      const mint = this.deps.mintWakeToken ?? mintWakeToken;
      this.wakeToken = mint(this.now);
      this.armedAt = this.now();
      this.armedFrames = [];
      this.endpointer.reset();
      this.setState("armed");
      return;
    }

    if (this.state !== "armed") return;

    this.armedFrames.push(samples16k.slice(0));
    if (this.now() - this.armedAt >= ARMED_MAX_MS) {
      await this.finishArmed("max_duration");
      return;
    }

    const ev = this.endpointer.push(samples16k);
    if (!ev || ev.type !== "speech_end") return;
    await this.finishArmed(ev.reason);
  }

  private async finishArmed(reason: "silence" | "max_duration" | "no_speech"): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      if (reason === "no_speech") {
        this.armedFrames = [];
        this.wakeToken = null;
        this.endpointer?.reset();
        this.setState("listening");
        return;
      }

      const frames = this.armedFrames;
      this.armedFrames = [];
      if (frames.length === 0) {
        this.wakeToken = null;
        this.endpointer?.reset();
        this.setState("listening");
        return;
      }

      this.setState("thinking");
      const concat = this.deps.concatFloat32 ?? concatFloat32;
      const encode = this.deps.encodeWav16 ?? encodeWav16;
      const stt = this.deps.transcribeWav ?? transcribeWav;
      const parse = this.deps.parseWakeUtterance ?? parseWakeUtterance;

      if (!this.azure?.key) {
        // Fatal: nothing can be transcribed until the operator adds the key.
        this.setError("azure_speech_key missing in vault");
        return;
      }

      const pcm = concat(frames);
      const wav = encode(pcm, 16_000);
      const result = await stt(wav, this.azure);
      if (!result.ok || !result.text?.trim()) {
        this.lastError = result.error ?? "empty transcript";
        this.wakeToken = null;
        this.endpointer?.reset();
        this.setState("listening");
        this.emitStatus();
        return;
      }

      const parsed = parse(result.text);
      const text = parsed.armed && parsed.command ? parsed.command : result.text.trim();
      this.lastTranscript = text;
      const token = this.wakeToken ?? (this.deps.mintWakeToken ?? mintWakeToken)(this.now);
      const utterance: JarvisVoiceUtterance = {
        text,
        wakeToken: token,
        at: this.now(),
      };
      this.wakeToken = null;
      this.endpointer?.reset();
      this.setState("listening");
      this.onEvent?.({ type: "utterance", utterance });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A failed round trip must not deafen the runtime: ingestFrame refuses to run
      // while the state is "error", so recover to listening and surface the message.
      this.setTransientError(msg);
    } finally {
      this.processing = false;
    }
  }

  private async buildDetector(): Promise<DetectorLike> {
    if (this.deps.createDetector) {
      return this.deps.createDetector({
        modelBaseUrl: chrome.runtime.getURL("public/openwakeword/"),
        createSession: async () => ({}),
        makeTensor: (data, dims) => ({ data, dims }),
      });
    }
    const ort = await loadOrt();
    ort.env.wasm.wasmPaths = chrome.runtime.getURL("public/ort/");
    // MV3 has no cross-origin isolation — SharedArrayBuffer threads unavailable.
    ort.env.wasm.numThreads = 1;
    return new WakeWordDetector({
      // ORT's Tensor/InferenceSession are structurally wider than OrtSessionLike (typed-array
      // unions, GPU locations); the wake pipeline only ever feeds float32 CPU tensors.
      createSession: (url) =>
        ort.InferenceSession.create(url, {
          executionProviders: ["wasm"],
        }) as unknown as Promise<OrtSessionLike>,
      makeTensor: (data, dims) => new ort.Tensor("float32", data, dims as number[]),
      config: { modelBaseUrl: chrome.runtime.getURL("public/openwakeword/") },
      now: this.now,
    });
  }

  private buildEndpointer(): EndpointerLike {
    if (this.deps.createEndpointer) return this.deps.createEndpointer();
    return new UtteranceEndpointer({ now: this.now });
  }

  private async startMic(): Promise<void> {
    const gum =
      this.deps.getUserMedia ??
      navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const stream = await gum({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.stream = stream;
    this.micGranted = true;

    const Ctx = this.deps.AudioContextCtor ?? AudioContext;
    const ctx = new Ctx();
    this.audioCtx = ctx;
    const source = ctx.createMediaStreamSource(stream);
    this.sourceNode = source;

    if (ctx.audioWorklet) {
      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, "jarvis-capture");
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
          void this.onNativePcm(ev.data, ctx.sampleRate);
        };
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(node);
        node.connect(gain);
        gain.connect(ctx.destination);
        this.workletNode = node;
        this.silentGain = gain;
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      const script = ctx.createScriptProcessor(CAPTURE_FRAME, 1, 1);
      script.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        void this.onNativePcm(input.slice(0), ctx.sampleRate);
      };
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(script);
      script.connect(gain);
      gain.connect(ctx.destination);
      this.scriptNode = script;
      this.silentGain = gain;
    }
  }

  private async onNativePcm(frame: Float32Array, sampleRate: number): Promise<void> {
    const down = this.deps.downsampleTo16k ?? downsampleTo16k;
    const at16 = sampleRate === 16_000 ? frame : down(frame, sampleRate);
    // Buffer to a stable chunk size for the detector.
    const merged = new Float32Array(this.captureBuf.length + at16.length);
    merged.set(this.captureBuf);
    merged.set(at16, this.captureBuf.length);
    const hop = 1280;
    let offset = 0;
    while (merged.length - offset >= hop) {
      const slice = merged.subarray(offset, offset + hop);
      offset += hop;
      await this.ingestFrame(slice.slice(0));
    }
    this.captureBuf = merged.slice(offset);
  }

  private teardownMic(): void {
    try {
      this.workletNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.scriptNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.silentGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.workletNode = null;
    this.scriptNode = null;
    this.sourceNode = null;
    this.silentGain = null;
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.captureBuf = new Float32Array(0);
  }

  private setState(state: JarvisVoiceState): void {
    this.state = state;
    this.emitStatus();
  }

  /** Fatal: needs operator action (missing key, denied mic, model load failure). */
  private setError(message: string): void {
    this.lastError = message;
    this.state = "error";
    this.emitStatus();
  }

  /** Recoverable: report it, drop the utterance, keep listening for the next wake. */
  private setTransientError(message: string): void {
    this.lastError = message;
    this.wakeToken = null;
    this.armedFrames = [];
    this.endpointer?.reset();
    this.detectionSuspended = false;
    this.setState(this.detector ? "listening" : "off");
  }

  private emitStatus(): void {
    this.onEvent?.({ type: "status", status: this.status() });
  }
}
