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
  frameRms,
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

export type ComboVoiceState =
  | "off"
  | "loading"
  | "listening"
  | "armed"
  | "thinking"
  | "speaking"
  | "error";

export interface ComboVoiceStatus {
  state: ComboVoiceState;
  micGranted: boolean;
  lastTranscript: string | null;
  lastError: string | null;
  locale: SpeechLocale;
  micOwner: "offscreen" | "daemon";
  debug: boolean;
}

export interface ComboVoiceUtterance {
  text: string;
  wakeToken: string;
  at: number;
}

export interface ComboDebugEntry {
  t: number;
  kind: string;
  detail?: Record<string, unknown>;
}

export type ComboVoiceEvent =
  | { type: "status"; status: ComboVoiceStatus }
  | { type: "utterance"; utterance: ComboVoiceUtterance }
  | { type: "debug"; entry: ComboDebugEntry };

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

export interface ComboVoiceDeps {
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
/** Keep ~2s of 16 kHz mono ahead of wake so one-breath commands survive late detection. */
const PRE_ROLL_SAMPLES = 16_000 * 2;
/** If VAD says no_speech but we already buffered this much energetic audio, still STT. */
const ONE_BREATH_MIN_MS = 400;
const ONE_BREATH_MIN_PEAK_RMS = 0.015;
/** STT soft-wake ("Hey Combo") cooldown — avoids burning Azure on chatter. */
const STT_WAKE_COOLDOWN_MS = 2_500;
const STT_WAKE_MIN_MS = 450;
const STT_WAKE_MIN_PEAK_RMS = 0.015;

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

export class ComboVoiceRuntime {
  onEvent: ((ev: ComboVoiceEvent) => void) | null = null;

  private state: ComboVoiceState = "off";
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
  private scriptNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private captureBuf = new Float32Array(0);
  private detector: DetectorLike | null = null;
  private endpointer: EndpointerLike | null = null;
  /** Separate endpointer for STT phrase-wake while listening (Hey Combo). */
  private listenEndpointer: EndpointerLike | null = null;
  private listenFrames: Float32Array[] = [];
  private lastSttWakeAt = 0;
  private readonly deps: ComboVoiceDeps;
  private readonly now: () => number;
  private debugEnabled = false;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private debugRmsTick = 0;
  private lastWakeScore: number | null = null;
  /** Sidepanel polls this — MV3 runtime.sendMessage relays drop utterances too often. */
  private pendingUtterances: ComboVoiceUtterance[] = [];

  constructor(deps: ComboVoiceDeps = {}) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  status(): ComboVoiceStatus {
    return {
      state: this.state,
      micGranted: this.micGranted,
      lastTranscript: this.lastTranscript,
      lastError: this.lastError,
      locale: this.locale,
      micOwner: "offscreen",
      debug: this.debugEnabled,
    };
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = Boolean(enabled);
    this.debug("debug_flag", { enabled: this.debugEnabled });
    this.emitStatus();
  }

  /** Atomically take queued voice commands for the sidepanel to run. */
  drainUtterances(): ComboVoiceUtterance[] {
    const out = this.pendingUtterances;
    this.pendingUtterances = [];
    return out;
  }

  private debug(kind: string, detail?: Record<string, unknown>): void {
    if (!this.debugEnabled) return;
    this.onEvent?.({
      type: "debug",
      entry: { t: this.now(), kind, detail },
    });
  }

  private pushPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame.slice(0));
    this.preRollSamples += frame.length;
    while (this.preRollSamples > PRE_ROLL_SAMPLES && this.preRoll.length > 1) {
      const drop = this.preRoll.shift();
      if (drop) this.preRollSamples -= drop.length;
    }
  }

  private clearPreRoll(): void {
    this.preRoll = [];
    this.preRollSamples = 0;
  }

  private framesStats(frames: Float32Array[]): { ms: number; peakRms: number; samples: number } {
    let samples = 0;
    let peakRms = 0;
    for (const f of frames) {
      samples += f.length;
      const r = frameRms(f);
      if (r > peakRms) peakRms = r;
    }
    return { ms: (samples / 16_000) * 1000, peakRms, samples };
  }

  async start(locale: SpeechLocale, azure: AzureSpeechConfig | null | undefined): Promise<ComboVoiceStatus> {
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
      this.listenEndpointer = this.buildEndpointer();
      this.listenEndpointer.reset();
      this.listenFrames = [];
      this.lastSttWakeAt = 0;

      if (!this.deps.skipMic) {
        await this.startMic();
      } else {
        this.micGranted = true;
      }

      this.wakeToken = null;
      this.armedFrames = [];
      this.clearPreRoll();
      this.detectionSuspended = false;
      this.setState("listening");
      this.debug("started", { locale: this.locale, region: this.azure?.region });
      return this.status();
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      // Default builds omit CC BY-NC wake ONNX assets — ORT fetch then surfaces
      // a bare "Failed to fetch". Point operators at the combo voice rebuild.
      if (/failed to fetch|404|not found|openwakeword/i.test(msg)) {
        msg =
          "Wake models missing — rebuild with `pnpm build:combo`, then reload. Use Test to verify Azure TTS without wake.";
      }
      this.setError(msg);
      return this.status();
    }
  }

  async stop(): Promise<ComboVoiceStatus> {
    this.teardownMic();
    this.detector = null;
    this.endpointer = null;
    this.listenEndpointer = null;
    this.listenFrames = [];
    this.wakeToken = null;
    this.armedFrames = [];
    this.clearPreRoll();
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
      if (!navigator.mediaDevices?.getUserMedia) {
        this.micGranted = false;
        this.lastError = "mediaDevices unavailable in offscreen";
        this.emitStatus();
        return false;
      }
      const gum =
        this.deps.getUserMedia ??
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const stream = await gum({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      this.micGranted = true;
      this.lastError = null;
      this.emitStatus();
      return true;
    } catch (err) {
      this.micGranted = false;
      this.lastError =
        err instanceof Error ? err.message : "Microphone not granted";
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
      this.pushPreRoll(samples16k);
      const rms = frameRms(samples16k);
      this.debugRmsTick += 1;
      if (this.debugEnabled && this.debugRmsTick % 12 === 0) {
        this.debug("mic", {
          rms: Number(rms.toFixed(4)),
          preRollMs: Math.round((this.preRollSamples / 16_000) * 1000),
          lastWakeScore: this.lastWakeScore,
        });
      }
      const hit = await this.detector.push(samples16k);
      if (hit) {
        this.lastWakeScore = hit.score;
        const mint = this.deps.mintWakeToken ?? mintWakeToken;
        this.wakeToken = mint(this.now);
        this.armedAt = this.now();
        // Seed with pre-roll so one-breath "Hey … go to google" still reaches STT.
        this.armedFrames = [...this.preRoll, samples16k.slice(0)];
        this.clearPreRoll();
        this.listenFrames = [];
        this.listenEndpointer?.reset();
        this.endpointer.reset();
        this.debug("wake_hit", {
          label: hit.label,
          score: hit.score,
          seededMs: Math.round(this.framesStats(this.armedFrames).ms),
          locale: this.locale,
        });
        this.setState("armed");
        return;
      }

      // Soft wake: no hey_combo ONNX exists — STT short utterances for WAKE_PHRASES
      // ("Hey Combo", "Hey Jarvis", …). Acoustic hey_jarvis still preferred when it fires.
      const lep = this.listenEndpointer;
      if (!lep) return;
      const lev = lep.push(samples16k);
      if (lev?.type === "speech_start") {
        this.listenFrames = [...this.preRoll, samples16k.slice(0)];
      } else if (lep.speaking || this.listenFrames.length > 0) {
        this.listenFrames.push(samples16k.slice(0));
      }
      if (lev?.type === "speech_end") {
        const frames = this.listenFrames;
        this.listenFrames = [];
        lep.reset();
        if (lev.reason !== "no_speech") {
          await this.tryPhraseWake(frames);
        }
      }
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

  /**
   * STT soft-wake for phrases with no ONNX model (esp. "Hey Combo").
   * Ambient speech without a wake phrase is ignored.
   */
  private async tryPhraseWake(frames: Float32Array[]): Promise<void> {
    if (this.processing) return;
    if (this.now() - this.lastSttWakeAt < STT_WAKE_COOLDOWN_MS) return;
    const stats = this.framesStats(frames);
    if (stats.ms < STT_WAKE_MIN_MS || stats.peakRms < STT_WAKE_MIN_PEAK_RMS) {
      this.debug("stt_wake_skip", { reason: "too_quiet_or_short", ...stats });
      return;
    }
    if (!this.azure?.key) return;

    this.processing = true;
    this.lastSttWakeAt = this.now();
    try {
      this.setState("thinking");
      const concat = this.deps.concatFloat32 ?? concatFloat32;
      const encode = this.deps.encodeWav16 ?? encodeWav16;
      const stt = this.deps.transcribeWav ?? transcribeWav;
      const parse = this.deps.parseWakeUtterance ?? parseWakeUtterance;
      const pcm = concat(frames);
      const wav = encode(pcm, 16_000);
      const sttStarted = this.now();
      const result = await stt(wav, this.azure);
      this.debug("stt_wake", {
        ok: result.ok,
        error: result.error ?? null,
        text: result.text ?? null,
        ms: this.now() - sttStarted,
        pcmMs: stats.ms,
        locale: this.azure.locale,
      });
      if (!result.ok || !result.text?.trim()) {
        this.setState("listening");
        return;
      }
      const parsed = parse(result.text);
      if (!parsed.armed) {
        // Ambient speech — ignore.
        this.setState("listening");
        return;
      }
      const mint = this.deps.mintWakeToken ?? mintWakeToken;
      this.wakeToken = mint(this.now);
      this.debug("wake_hit", {
        label: "stt_phrase",
        matchedPhrase: parsed.matchedPhrase,
        score: 1,
        seededMs: Math.round(stats.ms),
        locale: this.locale,
      });
      if (parsed.command.trim()) {
        this.emitUtterance(parsed.command.trim());
        this.setState("listening");
        return;
      }
      // Wake only — wait for the command (same as acoustic arm).
      this.armedAt = this.now();
      this.armedFrames = [];
      this.endpointer?.reset();
      this.setState("armed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setTransientError(msg);
    } finally {
      this.processing = false;
    }
  }

  private emitUtterance(text: string): void {
    const token = this.wakeToken ?? (this.deps.mintWakeToken ?? mintWakeToken)(this.now);
    this.wakeToken = null;
    this.lastTranscript = text;
    this.lastError = null;
    const utterance: ComboVoiceUtterance = {
      text,
      wakeToken: token,
      at: this.now(),
    };
    this.pendingUtterances.push(utterance);
    if (this.pendingUtterances.length > 20) {
      this.pendingUtterances.splice(0, this.pendingUtterances.length - 20);
    }
    this.debug("utterance", { text, via: "emit" });
    this.onEvent?.({ type: "utterance", utterance });
  }

  private async finishArmed(reason: "silence" | "max_duration" | "no_speech"): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const frames = this.armedFrames;
      this.armedFrames = [];
      const stats = this.framesStats(frames);
      this.debug("armed_end", { reason, ...stats, locale: this.locale });

      // Late wake: VAD saw only silence *after* arm, but pre-roll already holds the command.
      const oneBreathRescue =
        reason === "no_speech" &&
        stats.ms >= ONE_BREATH_MIN_MS &&
        stats.peakRms >= ONE_BREATH_MIN_PEAK_RMS;

      if (reason === "no_speech" && !oneBreathRescue) {
        this.wakeToken = null;
        this.endpointer?.reset();
        this.lastError = null;
        this.setState("listening");
        return;
      }

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
      const sttStarted = this.now();
      const result = await stt(wav, this.azure);
      this.debug("stt", {
        ok: result.ok,
        error: result.error ?? null,
        text: result.text ?? null,
        ms: this.now() - sttStarted,
        pcmMs: stats.ms,
        locale: this.azure.locale,
        rescued: oneBreathRescue,
      });
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
      this.endpointer?.reset();
      this.setState("listening");
      this.debug("utterance", { text, matchedPhrase: parsed.matchedPhrase ?? null });
      this.emitUtterance(text);
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
    // MV3: no COI / no blob: workers. Force single-thread + no proxy so ORT never
    // hits URL.createObjectURL (CSP script-src 'self' blocks blob:chrome-extension:…).
    ort.env.wasm.proxy = false;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
      mjs: chrome.runtime.getURL("public/ort/ort-wasm-simd-threaded.mjs"),
      wasm: chrome.runtime.getURL("public/ort/ort-wasm-simd-threaded.wasm"),
    };
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

    // Do NOT use AudioWorklet in MV3 extension pages/offscreen: even
    // chrome.runtime.getURL worklets are rewritten through blob:chrome-extension:…
    // by Chromium and then blocked by script-src 'self' (no blob: allowed in
    // extension_pages CSP). ScriptProcessor is deprecated but works here.
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

  private setState(state: ComboVoiceState): void {
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

/** @deprecated use ComboVoiceRuntime */
export { ComboVoiceRuntime as JarvisVoiceRuntime };

/** @deprecated use ComboVoiceState */
export type JarvisVoiceState = ComboVoiceState;
/** @deprecated use ComboVoiceStatus */
export type JarvisVoiceStatus = ComboVoiceStatus;
/** @deprecated use ComboVoiceUtterance */
export type JarvisVoiceUtterance = ComboVoiceUtterance;
/** @deprecated use ComboDebugEntry */
export type JarvisDebugEntry = ComboDebugEntry;
/** @deprecated use ComboVoiceEvent */
export type JarvisVoiceEvent = ComboVoiceEvent;
/** @deprecated use ComboVoiceDeps */
export type JarvisVoiceDeps = ComboVoiceDeps;
