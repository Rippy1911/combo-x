import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@combo-x/core", () => ({
  WakeWordDetector: class {},
  UtteranceEndpointer: class {},
  encodeWav16: (samples: Float32Array) => samples.buffer,
  concatFloat32: (chunks: Float32Array[]) => {
    const n = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  },
  downsampleTo16k: (input: Float32Array) => input,
  transcribeWav: vi.fn(),
  synthesizeSpeech: vi.fn(),
  parseWakeUtterance: (text: string) => {
    const lower = text.toLowerCase();
    if (lower.startsWith("hey jarvis")) {
      return {
        armed: true,
        command: text.slice("hey jarvis".length).trim(),
        matchedPhrase: "hey jarvis",
      };
    }
    return { armed: false, command: "", matchedPhrase: null };
  },
  mintWakeToken: (now?: () => number) => `wk_${(now ?? Date.now)()}`,
}));

import { JarvisVoiceRuntime, type DetectorLike, type EndpointerLike } from "./jarvisVoice.js";

function silence(n = 320): Float32Array {
  return new Float32Array(n);
}

describe("JarvisVoiceRuntime", () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
    };
  });

  it("discards ambient audio until wake detection", async () => {
    let pushes = 0;
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      async push() {
        pushes += 1;
        return null;
      },
    };
    const endpointer: EndpointerLike = {
      speaking: false,
      reset: vi.fn(),
      push: vi.fn(() => null),
    };
    const transcribe = vi.fn();
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => endpointer,
      transcribeWav: transcribe,
      now: () => 1000,
    });
    const events: unknown[] = [];
    rt.onEvent = (e) => events.push(e);

    await rt.start("pl-PL", { key: "k", region: "northeurope", locale: "pl-PL" });
    await rt.ingestFrame(silence());
    await rt.ingestFrame(silence());
    expect(pushes).toBe(2);
    expect(endpointer.push).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(rt.status().state).toBe("listening");
  });

  it("arms and mints a wake token on detection", async () => {
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      async push() {
        return { label: "hey_jarvis", score: 0.9, at: 2000 };
      },
    };
    const reset = vi.fn();
    const endpointer: EndpointerLike = {
      speaking: false,
      reset,
      push: () => null,
    };
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => endpointer,
      mintWakeToken: () => "wk_test_token",
      now: () => 2000,
    });
    await rt.start("en-US", { key: "k", region: "northeurope", locale: "en-US" });
    await rt.ingestFrame(silence());
    expect(rt.status().state).toBe("armed");
    expect(reset).toHaveBeenCalled();
  });

  it("speech_end:no_speech returns to listening without STT", async () => {
    let armed = false;
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      async push() {
        if (armed) return null;
        armed = true;
        return { label: "hey_jarvis", score: 0.9, at: 1 };
      },
    };
    const endpointer: EndpointerLike = {
      speaking: false,
      reset: vi.fn(),
      push: () => ({ type: "speech_end", at: 2, reason: "no_speech" }),
    };
    const transcribe = vi.fn();
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => endpointer,
      transcribeWav: transcribe,
      mintWakeToken: () => "wk_a",
      now: () => 1,
    });
    await rt.start("pl-PL", { key: "k", region: "northeurope", locale: "pl-PL" });
    await rt.ingestFrame(silence()); // detect → armed
    await rt.ingestFrame(silence()); // no_speech
    expect(transcribe).not.toHaveBeenCalled();
    expect(rt.status().state).toBe("listening");
  });

  it("emits utterance with text and wakeToken on success", async () => {
    let phase: "listen" | "armed" = "listen";
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      async push() {
        if (phase === "listen") {
          phase = "armed";
          return { label: "hey_jarvis", score: 0.95, at: 10 };
        }
        return null;
      },
    };
    let pushes = 0;
    const endpointer: EndpointerLike = {
      speaking: true,
      reset: vi.fn(),
      push: () => {
        pushes += 1;
        if (pushes < 2) return null;
        return { type: "speech_end", at: 20, reason: "silence" };
      },
    };
    const transcribe = vi.fn(async () => ({
      ok: true,
      text: "hey jarvis open mail",
    }));
    const events: Array<{ type: string; utterance?: { text: string; wakeToken: string } }> = [];
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => endpointer,
      transcribeWav: transcribe,
      mintWakeToken: () => "wk_utter",
      now: () => 50,
    });
    rt.onEvent = (e) => events.push(e as (typeof events)[number]);

    await rt.start("en-US", { key: "k", region: "northeurope", locale: "en-US" });
    await rt.ingestFrame(silence());
    await rt.ingestFrame(silence(640));
    await rt.ingestFrame(silence(640));

    const utterance = events.find((e) => e.type === "utterance");
    expect(utterance?.utterance).toEqual({
      text: "open mail",
      wakeToken: "wk_utter",
      at: 50,
    });
    expect(transcribe).toHaveBeenCalled();
    expect(rt.status().state).toBe("listening");
  });

  it("enforces the 20s armed cap", async () => {
    let t = 0;
    let detected = false;
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      async push() {
        if (detected) return null;
        detected = true;
        return { label: "hey_jarvis", score: 1, at: 0 };
      },
    };
    const endpointer: EndpointerLike = {
      speaking: true,
      reset: vi.fn(),
      push: () => null,
    };
    const transcribe = vi.fn(async () => ({ ok: true, text: "status" }));
    const events: Array<{ type: string }> = [];
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => endpointer,
      transcribeWav: transcribe,
      mintWakeToken: () => "wk_cap",
      parseWakeUtterance: () => ({ armed: false, command: "", matchedPhrase: null }),
      now: () => t,
    });
    rt.onEvent = (e) => events.push(e);
    await rt.start("pl-PL", { key: "k", region: "northeurope", locale: "pl-PL" });
    t = 0;
    await rt.ingestFrame(silence());
    expect(rt.status().state).toBe("armed");
    // Accumulate speech while armed, then trip the hard cap.
    t = 100;
    await rt.ingestFrame(silence(640));
    t = 20_001;
    await rt.ingestFrame(silence());
    expect(transcribe).toHaveBeenCalled();
    expect(rt.status().state).toBe("listening");
    expect(events.some((e) => e.type === "utterance")).toBe(true);
  });

  it("suspends wake detection while speaking", async () => {
    const push = vi.fn(async () => null);
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      push,
    };
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => ({
        speaking: false,
        reset() {},
        push: () => null,
      }),
      synthesizeSpeech: async () => ({
        ok: true,
        audio: new ArrayBuffer(8),
        mime: "audio/mpeg",
      }),
      playAudio: async () => {
        await rt.ingestFrame(silence());
      },
      now: () => 1,
    });
    await rt.start("en-US", { key: "k", region: "northeurope", locale: "en-US" });
    push.mockClear();
    await rt.speak("hello");
    expect(push).not.toHaveBeenCalled();
    await rt.ingestFrame(silence());
    expect(push).toHaveBeenCalled();
  });

  it("keeps listening after a failed STT round trip", async () => {
    let detected = false;
    const detector: DetectorLike = {
      ready: true,
      async load() {},
      reset() {},
      async push() {
        if (detected) return null;
        detected = true;
        return { label: "hey_jarvis", score: 1, at: 0 };
      },
    };
    const endpointer: EndpointerLike = {
      speaking: true,
      reset: vi.fn(),
      push: () => ({ type: "speech_end", at: 5, reason: "silence" }),
    };
    const transcribe = vi.fn(async () => {
      throw new Error("network down");
    });
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => detector,
      createEndpointer: () => endpointer,
      transcribeWav: transcribe as never,
      mintWakeToken: () => "wk_fail",
      now: () => 1,
    });
    await rt.start("pl-PL", { key: "k", region: "northeurope", locale: "pl-PL" });
    await rt.ingestFrame(silence()); // detect → armed
    await rt.ingestFrame(silence(640)); // speech_end → STT throws

    expect(transcribe).toHaveBeenCalled();
    // A dead network must surface the error without deafening the wake loop.
    expect(rt.status().lastError).toBe("network down");
    expect(rt.status().state).toBe("listening");

    // The next wake word must still arm.
    detected = false;
    await rt.ingestFrame(silence());
    expect(rt.status().state).toBe("armed");
  });

  it("keeps listening after a failed TTS synthesis", async () => {
    const rt = new JarvisVoiceRuntime({
      skipMic: true,
      createDetector: () => ({
        ready: true,
        async load() {},
        reset() {},
        async push() {
          return null;
        },
      }),
      createEndpointer: () => ({ speaking: false, reset() {}, push: () => null }),
      synthesizeSpeech: async () => ({ ok: false, error: "tts 429" }),
      now: () => 1,
    });
    await rt.start("en-US", { key: "k", region: "northeurope", locale: "en-US" });
    const res = await rt.speak("hello");
    expect(res).toEqual({ ok: false, error: "tts 429" });
    expect(rt.status().state).toBe("listening");
    expect(rt.status().lastError).toBe("tts 429");
  });

  it("errors when azure key is missing", async () => {
    const rt = new JarvisVoiceRuntime({ skipMic: true });
    const status = await rt.start("pl-PL", null);
    expect(status.state).toBe("error");
    expect(status.lastError).toBe("azure_speech_key missing in vault");
  });
});
