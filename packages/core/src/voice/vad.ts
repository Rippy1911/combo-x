export interface EndpointerConfig {
  silenceMs?: number;
  maxUtteranceMs?: number;
  minSpeechMs?: number;
  startRms?: number;
  endRms?: number;
}

export type EndpointerEvent =
  | { type: "speech_start"; at: number }
  | { type: "speech_end"; at: number; reason: "silence" | "max_duration" | "no_speech" };

export const DEFAULT_ENDPOINTER: Required<EndpointerConfig> = {
  silenceMs: 700,
  maxUtteranceMs: 15_000,
  minSpeechMs: 250,
  startRms: 0.02,
  endRms: 0.012,
};

export function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const x = frame[i]!;
    sum += x * x;
  }
  return Math.sqrt(sum / frame.length);
}

export class UtteranceEndpointer {
  private readonly cfg: Required<EndpointerConfig>;
  private readonly now: () => number;
  private sessionStart: number;
  private _speaking = false;
  private speechStartAt = 0;
  private silenceStartAt: number | null = null;
  private noiseFloor: number;
  private ended = false;

  constructor(opts?: { config?: EndpointerConfig; now?: () => number }) {
    this.cfg = { ...DEFAULT_ENDPOINTER, ...opts?.config };
    this.now = opts?.now ?? (() => Date.now());
    this.sessionStart = this.now();
    this.noiseFloor = this.cfg.endRms * 0.5;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  reset(): void {
    this._speaking = false;
    this.speechStartAt = 0;
    this.silenceStartAt = null;
    this.sessionStart = this.now();
    this.noiseFloor = this.cfg.endRms * 0.5;
    this.ended = false;
  }

  push(frame: Float32Array, speechProb?: number): EndpointerEvent | null {
    if (this.ended) return null;
    const at = this.now();
    const rms = frameRms(frame);
    const isSpeech =
      speechProb !== undefined
        ? speechProb >= 0.5
        : this._speaking
          ? rms >= Math.max(this.cfg.endRms, this.noiseFloor)
          : rms >= Math.max(this.cfg.startRms, this.noiseFloor * 1.5);

    if (!this._speaking) {
      if (!isSpeech) {
        // Adaptive noise floor while idle.
        this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
        if (at - this.sessionStart >= this.cfg.maxUtteranceMs) {
          this.ended = true;
          return { type: "speech_end", at, reason: "no_speech" };
        }
        return null;
      }
      this._speaking = true;
      this.speechStartAt = at;
      this.silenceStartAt = null;
      return { type: "speech_start", at };
    }

    // Speaking.
    if (at - this.speechStartAt >= this.cfg.maxUtteranceMs) {
      this._speaking = false;
      this.ended = true;
      return { type: "speech_end", at, reason: "max_duration" };
    }

    if (isSpeech) {
      this.silenceStartAt = null;
      return null;
    }

    if (this.silenceStartAt === null) this.silenceStartAt = at;
    const silenceDur = at - this.silenceStartAt;
    const speechDur = this.silenceStartAt - this.speechStartAt;
    if (silenceDur >= this.cfg.silenceMs) {
      if (speechDur >= this.cfg.minSpeechMs) {
        this._speaking = false;
        this.ended = true;
        return { type: "speech_end", at, reason: "silence" };
      }
      // Click/pop: discard false start without emitting speech_end.
      this._speaking = false;
      this.silenceStartAt = null;
      this.speechStartAt = 0;
      return null;
    }
    return null;
  }
}
