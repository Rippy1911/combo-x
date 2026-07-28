import { describe, expect, it } from "vitest";
import { frameRms, UtteranceEndpointer } from "./vad.js";

function tone(rms: number, n = 320): Float32Array {
  // Constant amplitude ≈ rms (for DC, rms = |amp|).
  return new Float32Array(n).fill(rms);
}

describe("frameRms", () => {
  it("computes energy", () => {
    expect(frameRms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(frameRms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 5);
  });
});

describe("UtteranceEndpointer", () => {
  it("ends on silence after ~700 ms", () => {
    let t = 0;
    const ep = new UtteranceEndpointer({ now: () => t });
    expect(ep.push(tone(0.05))?.type).toBe("speech_start");
    t += 300;
    expect(ep.push(tone(0.05))).toBeNull();
    t += 300; // speech lasted 600 ms so far
    // Enter silence
    expect(ep.push(tone(0.001))).toBeNull();
    t += 700;
    const end = ep.push(tone(0.001));
    expect(end).toEqual({ type: "speech_end", at: t, reason: "silence" });
  });

  it("ends on max duration", () => {
    let t = 0;
    const ep = new UtteranceEndpointer({
      config: { maxUtteranceMs: 1_000 },
      now: () => t,
    });
    expect(ep.push(tone(0.05))?.type).toBe("speech_start");
    t += 1_000;
    const end = ep.push(tone(0.05));
    expect(end).toEqual({ type: "speech_end", at: t, reason: "max_duration" });
  });

  it("rejects a click/pop shorter than minSpeechMs", () => {
    let t = 0;
    const ep = new UtteranceEndpointer({
      config: { minSpeechMs: 250, silenceMs: 100 },
      now: () => t,
    });
    expect(ep.push(tone(0.05))?.type).toBe("speech_start");
    t += 50; // too short
    expect(ep.push(tone(0.001))).toBeNull();
    t += 100;
    // Should discard false start — no speech_end
    expect(ep.push(tone(0.001))).toBeNull();
    expect(ep.speaking).toBe(false);
  });

  it("emits no_speech when nothing starts within maxUtteranceMs", () => {
    let t = 0;
    const ep = new UtteranceEndpointer({
      config: { maxUtteranceMs: 500 },
      now: () => t,
    });
    expect(ep.push(tone(0.001))).toBeNull();
    t += 500;
    expect(ep.push(tone(0.001))).toEqual({
      type: "speech_end",
      at: t,
      reason: "no_speech",
    });
  });

  it("hysteresis: mid band does not start but sustains speech", () => {
    let t = 0;
    const ep = new UtteranceEndpointer({
      config: { startRms: 0.02, endRms: 0.012 },
      now: () => t,
    });
    // Between end and start — must not start.
    expect(ep.push(tone(0.015))).toBeNull();
    expect(ep.speaking).toBe(false);

    expect(ep.push(tone(0.03))?.type).toBe("speech_start");
    t += 100;
    // Drop into mid band — still speaking (above endRms).
    expect(ep.push(tone(0.015))).toBeNull();
    expect(ep.speaking).toBe(true);
  });

  it("speechProb override treats >= 0.5 as speech", () => {
    let t = 0;
    const ep = new UtteranceEndpointer({ now: () => t });
    // Low energy but high speechProb
    expect(ep.push(tone(0.001), 0.9)?.type).toBe("speech_start");
    t += 300;
    expect(ep.push(tone(0.001), 0.9)).toBeNull();
    expect(ep.speaking).toBe(true);
    // Low speechProb ends into silence tracking
    expect(ep.push(tone(0.001), 0.1)).toBeNull();
    t += 700;
    const end = ep.push(tone(0.001), 0.1);
    expect(end?.type === "speech_end" ? end.reason : null).toBe("silence");
  });
});
