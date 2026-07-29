import type { MakeTensor, OrtSessionFactory, OrtSessionLike } from "./types.js";

export const WAKE_SAMPLE_RATE = 16_000;
export const WAKE_FRAME_SAMPLES = 1_280; // 80 ms hop
export const DEFAULT_WAKE_THRESHOLD = 0.5;
export const DEFAULT_WAKE_COOLDOWN_MS = 2_000;

/** openWakeWord keeps 3×160 samples of prior audio for streaming mel continuity. */
const MEL_CONTEXT_SAMPLES = 160 * 3;
const MEL_BINS = 32;
const MEL_WINDOW_FRAMES = 76;
const MEL_STRIDE_FRAMES = 8;
const EMBEDDING_DIM = 96;
const WAKE_EMBEDDING_FRAMES = 16;

export interface WakeConfig {
  modelBaseUrl: string;
  wakeModelFile?: string;
  threshold?: number;
  cooldownMs?: number;
}

export interface WakeDetection {
  label: string;
  score: number;
  at: number;
}

export function joinModelUrl(base: string, file: string): string {
  const b = base.replace(/\/+$/, "");
  const f = file.replace(/^\/+/, "");
  return `${b}/${f}`;
}

export function scoreCrossed(score: number, threshold: number): boolean {
  return score >= threshold;
}

export class RollingWindow {
  private buf: Float32Array;
  private len = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  get length(): number {
    return this.len;
  }

  push(v: Float32Array): void {
    if (v.length >= this.capacity) {
      this.buf.set(v.subarray(v.length - this.capacity));
      this.len = this.capacity;
      return;
    }
    const overflow = this.len + v.length - this.capacity;
    if (overflow > 0) {
      this.buf.copyWithin(0, overflow, this.len);
      this.len -= overflow;
    }
    this.buf.set(v, this.len);
    this.len += v.length;
  }

  take(n: number): Float32Array | null {
    if (n < 0 || this.len < n) return null;
    return this.buf.slice(0, n);
  }

  drop(n: number): void {
    if (n <= 0) return;
    if (n >= this.len) {
      this.len = 0;
      return;
    }
    this.buf.copyWithin(0, n, this.len);
    this.len -= n;
  }

  clear(): void {
    this.len = 0;
  }
}

export class WakeWordDetector {
  private readonly createSession: OrtSessionFactory;
  private readonly makeTensor: MakeTensor;
  private readonly config: WakeConfig;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly wakeFile: string;

  private melSession: OrtSessionLike | null = null;
  private embSession: OrtSessionLike | null = null;
  private wakeSession: OrtSessionLike | null = null;
  private _ready = false;

  /** Samples not yet consumed by a mel hop. */
  private unprocessed = new RollingWindow(WAKE_SAMPLE_RATE * 10);
  /** Tail kept for mel context across hops. */
  private melContext = new Float32Array(0);
  private melFrames: number[][] = [];
  private embeddings: Float32Array[] = [];
  private lastDetectAt = -Infinity;
  private wakeLabel: string;

  constructor(opts: {
    createSession: OrtSessionFactory;
    makeTensor: MakeTensor;
    config: WakeConfig;
    now?: () => number;
  }) {
    this.createSession = opts.createSession;
    this.makeTensor = opts.makeTensor;
    this.config = opts.config;
    this.now = opts.now ?? (() => Date.now());
    this.threshold = opts.config.threshold ?? DEFAULT_WAKE_THRESHOLD;
    this.cooldownMs = opts.config.cooldownMs ?? DEFAULT_WAKE_COOLDOWN_MS;
    this.wakeFile = opts.config.wakeModelFile ?? "hey_jarvis_v0.1.onnx";
    this.wakeLabel = this.wakeFile.replace(/\.onnx$/i, "");
  }

  get ready(): boolean {
    return this._ready;
  }

  async load(): Promise<void> {
    const base = this.config.modelBaseUrl;
    this.melSession = await this.createSession(joinModelUrl(base, "melspectrogram.onnx"));
    this.embSession = await this.createSession(joinModelUrl(base, "embedding_model.onnx"));
    this.wakeSession = await this.createSession(joinModelUrl(base, this.wakeFile));
    this._ready = true;
  }

  reset(): void {
    this.unprocessed.clear();
    this.melContext = new Float32Array(0);
    this.melFrames = [];
    this.embeddings = [];
    this.lastDetectAt = -Infinity;
  }

  async push(samples: Float32Array): Promise<WakeDetection | null> {
    if (!this._ready || !this.melSession || !this.embSession || !this.wakeSession) {
      throw new Error("WakeWordDetector.load() must be called before push()");
    }

    this.unprocessed.push(samples);
    let detection: WakeDetection | null = null;

    while (this.unprocessed.length >= WAKE_FRAME_SAMPLES) {
      const hop = this.unprocessed.take(WAKE_FRAME_SAMPLES)!;
      this.unprocessed.drop(WAKE_FRAME_SAMPLES);

      const melInput = new Float32Array(this.melContext.length + hop.length);
      melInput.set(this.melContext, 0);
      melInput.set(hop, this.melContext.length);

      const frames = await this.runMel(melInput);
      for (const f of frames) this.melFrames.push(f);

      // Keep last MEL_CONTEXT_SAMPLES of this mel input as next context.
      if (melInput.length >= MEL_CONTEXT_SAMPLES) {
        this.melContext = melInput.slice(melInput.length - MEL_CONTEXT_SAMPLES);
      } else {
        this.melContext = melInput.slice();
      }

      while (this.melFrames.length >= MEL_WINDOW_FRAMES) {
        const window = this.melFrames.slice(0, MEL_WINDOW_FRAMES);
        const emb = await this.runEmbedding(window);
        this.embeddings.push(emb);
        this.melFrames.splice(0, MEL_STRIDE_FRAMES);

        if (this.embeddings.length > 120) {
          this.embeddings = this.embeddings.slice(-120);
        }

        if (this.embeddings.length >= WAKE_EMBEDDING_FRAMES) {
          const score = await this.runWake(this.embeddings.slice(-WAKE_EMBEDDING_FRAMES));
          const at = this.now();
          if (
            detection === null &&
            scoreCrossed(score, this.threshold) &&
            at - this.lastDetectAt >= this.cooldownMs
          ) {
            this.lastDetectAt = at;
            detection = { label: this.wakeLabel, score, at };
          }
        }
      }
    }

    return detection;
  }

  private async runMel(audio: Float32Array): Promise<number[][]> {
    const session = this.melSession!;
    const name = session.inputNames[0]!;
    const feeds = {
      [name]: this.makeTensor(Float32Array.from(audio), [1, audio.length]),
    };
    const out = await session.run(feeds);
    const key = session.outputNames[0]!;
    const tensor = out[key]!;
    const dims = tensor.dims;
    const frames = dims.length >= 3 ? Number(dims[dims.length - 2]) : 0;
    const bins = dims.length >= 1 ? Number(dims[dims.length - 1]) : MEL_BINS;
    const data = tensor.data;
    const result: number[][] = [];
    for (let f = 0; f < frames; f++) {
      const row = new Array<number>(bins);
      for (let b = 0; b < bins; b++) {
        const raw = data[f * bins + b] ?? 0;
        row[b] = raw / 10 + 2;
      }
      result.push(row);
    }
    return result;
  }

  private async runEmbedding(frames: number[][]): Promise<Float32Array> {
    const session = this.embSession!;
    const name = session.inputNames[0]!;
    const data = new Float32Array(MEL_WINDOW_FRAMES * MEL_BINS);
    for (let f = 0; f < MEL_WINDOW_FRAMES; f++) {
      const row = frames[f]!;
      for (let b = 0; b < MEL_BINS; b++) {
        data[f * MEL_BINS + b] = row[b] ?? 0;
      }
    }
    const feeds = {
      [name]: this.makeTensor(data, [1, MEL_WINDOW_FRAMES, MEL_BINS, 1]),
    };
    const out = await session.run(feeds);
    const key = session.outputNames[0]!;
    const tensor = out[key]!;
    return tensor.data.slice(0, EMBEDDING_DIM);
  }

  private async runWake(embs: Float32Array[]): Promise<number> {
    const session = this.wakeSession!;
    const name = session.inputNames[0]!;
    const data = new Float32Array(WAKE_EMBEDDING_FRAMES * EMBEDDING_DIM);
    for (let i = 0; i < WAKE_EMBEDDING_FRAMES; i++) {
      data.set(embs[i]!.subarray(0, EMBEDDING_DIM), i * EMBEDDING_DIM);
    }
    const feeds = {
      [name]: this.makeTensor(data, [1, WAKE_EMBEDDING_FRAMES, EMBEDDING_DIM]),
    };
    const out = await session.run(feeds);
    const key = session.outputNames[0]!;
    return Number(out[key]!.data[0] ?? 0);
  }
}
