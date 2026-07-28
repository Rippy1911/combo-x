import { describe, expect, it, vi } from "vitest";
import {
  AZURE_SPEECH_KEY_LABEL,
  AZURE_SPEECH_REGION_LABEL,
  buildSsml,
  DEFAULT_AZURE_REGION,
  resolveAzureSpeechConfig,
  sttEndpoint,
  synthesizeSpeech,
  transcribeWav,
  ttsEndpoint,
} from "./azureSpeech.js";

const cfg = {
  key: "super-secret-key-xyz",
  region: "northeurope",
  locale: "pl-PL" as const,
  voice: "pl-PL-ZofiaNeural",
};

describe("azureSpeech helpers", () => {
  it("builds endpoints", () => {
    expect(sttEndpoint("northeurope", "pl-PL")).toContain(
      "northeurope.stt.speech.microsoft.com",
    );
    expect(sttEndpoint("northeurope", "pl-PL")).toContain("language=pl-PL");
    expect(ttsEndpoint("westeurope")).toBe(
      "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1",
    );
  });

  it("XML-escapes SSML text including Polish and special chars", () => {
    const ssml = buildSsml('Cześć & <test> "ok"', "pl-PL-ZofiaNeural", "pl-PL");
    expect(ssml).toContain("&amp;");
    expect(ssml).toContain("&lt;");
    expect(ssml).toContain("&gt;");
    expect(ssml).toContain("&quot;");
    expect(ssml).toContain('xml:lang="pl-PL"');
    expect(ssml).not.toContain("Cześć & <");
  });
});

describe("transcribeWav", () => {
  it("POSTs wav with correct headers and prefers NBest", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(sttEndpoint(cfg.region, cfg.locale));
      const h = init?.headers as Record<string, string>;
      expect(h["Ocp-Apim-Subscription-Key"]).toBe(cfg.key);
      expect(h["Content-Type"]).toContain("audio/wav");
      expect(h["Accept"]).toBe("application/json");
      expect(init?.body).toBeInstanceOf(ArrayBuffer);
      return new Response(
        JSON.stringify({
          RecognitionStatus: "Success",
          DisplayText: "fallback",
          NBest: [{ Display: "Hej Jarvis", Confidence: 0.91 }],
        }),
        { status: 200 },
      );
    });
    const r = await transcribeWav(new ArrayBuffer(8), cfg, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, text: "Hej Jarvis", confidence: 0.91 });
  });

  it("falls back to DisplayText", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ RecognitionStatus: "Success", DisplayText: "Hello" }),
          { status: 200 },
        ),
    );
    const r = await transcribeWav(new ArrayBuffer(0), cfg, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Hello");
  });

  it("maps NoMatch to no_speech", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ RecognitionStatus: "NoMatch" }), { status: 200 }),
    );
    const r = await transcribeWav(new ArrayBuffer(0), cfg, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toEqual({ ok: false, error: "no_speech" });
  });

  it("maps non-2xx without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const r = await transcribeWav(new ArrayBuffer(0), cfg, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("azure_stt_401");
    expect(JSON.stringify(r)).not.toContain(cfg.key);
  });
});

describe("synthesizeSpeech", () => {
  it("POSTs SSML with TTS headers", async () => {
    const audioBytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(ttsEndpoint(cfg.region));
      const h = init?.headers as Record<string, string>;
      expect(h["Ocp-Apim-Subscription-Key"]).toBe(cfg.key);
      expect(h["Content-Type"]).toBe("application/ssml+xml");
      expect(h["X-Microsoft-OutputFormat"]).toBe("audio-24khz-48kbitrate-mono-mp3");
      expect(h["User-Agent"]).toBe("combo-x-jarvis");
      expect(String(init?.body)).toContain("<speak");
      return new Response(audioBytes, { status: 200 });
    });
    const r = await synthesizeSpeech("Cześć", cfg, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.mime).toBe("audio/mpeg");
    expect(r.audio?.byteLength).toBe(3);
  });
});

describe("resolveAzureSpeechConfig", () => {
  it("returns null without key; defaults region", async () => {
    expect(
      await resolveAzureSpeechConfig(async () => null, "en-US"),
    ).toBeNull();

    const cfg2 = await resolveAzureSpeechConfig(async (label) => {
      if (label === AZURE_SPEECH_KEY_LABEL) return "k";
      if (label === AZURE_SPEECH_REGION_LABEL) return null;
      return null;
    }, "en-US");
    expect(cfg2?.region).toBe(DEFAULT_AZURE_REGION);
    expect(cfg2?.voice).toBe("en-US-AriaNeural");
  });
});
