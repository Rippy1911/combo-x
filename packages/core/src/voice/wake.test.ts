import { describe, expect, it } from "vitest";
import type { MakeTensor, OrtSessionFactory, OrtSessionLike, OrtTensorLike } from "./types.js";
import {
  DEFAULT_WAKE_COOLDOWN_MS,
  joinModelUrl,
  RollingWindow,
  scoreCrossed,
  WAKE_FRAME_SAMPLES,
  WakeWordDetector,
} from "./wake.js";

const makeTensor: MakeTensor = (data, dims) => ({ data, dims });

function tensor(data: Float32Array, dims: readonly number[]): OrtTensorLike {
  return { data, dims };
}

type FakeOpts = {
  wakeScores: number[];
  melFramesPerHop?: number;
};

function createFakeFactory(opts: FakeOpts): {
  factory: OrtSessionFactory;
  melCalls: Array<{ dims: readonly number[] }>;
  embCalls: Array<{ dims: readonly number[] }>;
  wakeCalls: Array<{ dims: readonly number[] }>;
} {
  const melCalls: Array<{ dims: readonly number[] }> = [];
  const embCalls: Array<{ dims: readonly number[] }> = [];
  const wakeCalls: Array<{ dims: readonly number[] }> = [];
  let scoreIdx = 0;
  const melFrames = opts.melFramesPerHop ?? 8;

  const factory: OrtSessionFactory = async (modelUrl) => {
    if (modelUrl.includes("melspectrogram")) {
      const session: OrtSessionLike = {
        inputNames: ["input"],
        outputNames: ["output"],
        async run(feeds) {
          const inp = feeds["input"]!;
          melCalls.push({ dims: inp.dims });
          const data = new Float32Array(melFrames * 32);
          // Raw values such that after /10+2 they stay finite.
          data.fill(0);
          return { output: tensor(data, [1, 1, melFrames, 32]) };
        },
      };
      return session;
    }
    if (modelUrl.includes("embedding_model")) {
      const session: OrtSessionLike = {
        inputNames: ["input"],
        outputNames: ["output"],
        async run(feeds) {
          const inp = feeds["input"]!;
          embCalls.push({ dims: inp.dims });
          expect(inp.dims).toEqual([1, 76, 32, 1]);
          return { output: tensor(new Float32Array(96), [1, 1, 1, 96]) };
        },
      };
      return session;
    }
    const session: OrtSessionLike = {
      inputNames: ["input"],
      outputNames: ["output"],
      async run(feeds) {
        const inp = feeds["input"]!;
        wakeCalls.push({ dims: inp.dims });
        expect(inp.dims).toEqual([1, 16, 96]);
        const score = opts.wakeScores[Math.min(scoreIdx, opts.wakeScores.length - 1)]!;
        scoreIdx++;
        return { output: tensor(Float32Array.of(score), [1, 1]) };
      },
    };
    return session;
  };

  return { factory, melCalls, embCalls, wakeCalls };
}

/** Enough 80 ms hops to fill 76 mel frames + 16 embeddings (8 mel frames/hop). */
const HOPS_TO_FIRST_SCORE = 10 + 15; // first emb at hop 10, 16th at hop 25

function silence(n: number): Float32Array {
  return new Float32Array(n);
}

describe("joinModelUrl", () => {
  it("normalizes slashes", () => {
    expect(joinModelUrl("https://x.com/models/", "/hey.onnx")).toBe(
      "https://x.com/models/hey.onnx",
    );
    expect(joinModelUrl("https://x.com/models", "hey.onnx")).toBe(
      "https://x.com/models/hey.onnx",
    );
  });
});

describe("scoreCrossed", () => {
  it("compares against threshold", () => {
    expect(scoreCrossed(0.5, 0.5)).toBe(true);
    expect(scoreCrossed(0.49, 0.5)).toBe(false);
  });
});

describe("RollingWindow", () => {
  it("pushes, takes, drops, and respects capacity", () => {
    const w = new RollingWindow(5);
    w.push(Float32Array.of(1, 2, 3));
    expect(w.length).toBe(3);
    expect(Array.from(w.take(2)!)).toEqual([1, 2]);
    w.drop(1);
    expect(Array.from(w.take(2)!)).toEqual([2, 3]);
    w.push(Float32Array.of(4, 5, 6, 7));
    expect(w.length).toBe(5);
    expect(Array.from(w.take(5)!)).toEqual([3, 4, 5, 6, 7]);
    w.clear();
    expect(w.length).toBe(0);
    expect(w.take(1)).toBeNull();
  });
});

describe("WakeWordDetector", () => {
  it("invokes the 3-stage chain with correct dims and detects once", async () => {
    const { factory, melCalls, embCalls, wakeCalls } = createFakeFactory({
      wakeScores: [0.9],
    });
    let t = 1_000;
    const det = new WakeWordDetector({
      createSession: factory,
      makeTensor,
      config: { modelBaseUrl: "https://cdn.example/oww/" },
      now: () => t,
    });
    await expect(det.push(silence(WAKE_FRAME_SAMPLES))).rejects.toThrow(/load/i);
    await det.load();
    expect(det.ready).toBe(true);

    let hit = null;
    for (let i = 0; i < HOPS_TO_FIRST_SCORE; i++) {
      t += 80;
      hit = await det.push(silence(WAKE_FRAME_SAMPLES));
    }
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeCloseTo(0.9, 5);
    expect(hit!.label).toBe("hey_jarvis_v0.1");

    expect(melCalls.length).toBeGreaterThan(0);
    expect(melCalls[0]!.dims[0]).toBe(1);
    expect(embCalls.length).toBeGreaterThanOrEqual(16);
    expect(embCalls[0]!.dims).toEqual([1, 76, 32, 1]);
    expect(wakeCalls[0]!.dims).toEqual([1, 16, 96]);
  });

  it("cooldown suppresses a second detection", async () => {
    const { factory } = createFakeFactory({ wakeScores: [0.95] });
    let t = 0;
    const det = new WakeWordDetector({
      createSession: factory,
      makeTensor,
      config: {
        modelBaseUrl: "https://cdn.example/oww",
        cooldownMs: DEFAULT_WAKE_COOLDOWN_MS,
      },
      now: () => t,
    });
    await det.load();

    let first = null;
    for (let i = 0; i < HOPS_TO_FIRST_SCORE; i++) {
      t += 80;
      first = (await det.push(silence(WAKE_FRAME_SAMPLES))) ?? first;
    }
    expect(first).not.toBeNull();

    // Still within cooldown — more high scores must not detect.
    let second = null;
    for (let i = 0; i < 5; i++) {
      t += 80; // +400 ms, still < 2000
      second = (await det.push(silence(WAKE_FRAME_SAMPLES))) ?? second;
    }
    expect(second).toBeNull();

    // After cooldown, next score detects again.
    t += DEFAULT_WAKE_COOLDOWN_MS;
    let third = null;
    for (let i = 0; i < 5; i++) {
      t += 80;
      third = (await det.push(silence(WAKE_FRAME_SAMPLES))) ?? third;
    }
    expect(third).not.toBeNull();
  });

  it("never detects below threshold", async () => {
    const { factory } = createFakeFactory({ wakeScores: [0.1] });
    let t = 0;
    const det = new WakeWordDetector({
      createSession: factory,
      makeTensor,
      config: { modelBaseUrl: "https://cdn.example/oww", threshold: 0.5 },
      now: () => t,
    });
    await det.load();
    let hit = null;
    for (let i = 0; i < HOPS_TO_FIRST_SCORE + 10; i++) {
      t += 80;
      hit = (await det.push(silence(WAKE_FRAME_SAMPLES))) ?? hit;
    }
    expect(hit).toBeNull();
  });
});
