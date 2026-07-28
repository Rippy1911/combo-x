export const AZURE_SPEECH_KEY_LABEL = "azure_speech_key";
export const AZURE_SPEECH_REGION_LABEL = "azure_speech_region";
export const DEFAULT_AZURE_REGION = "northeurope";

export const SPEECH_LOCALES = ["pl-PL", "en-US"] as const;
export type SpeechLocale = (typeof SPEECH_LOCALES)[number];

export const DEFAULT_VOICE_BY_LOCALE: Record<SpeechLocale, string> = {
  "pl-PL": "pl-PL-ZofiaNeural",
  "en-US": "en-US-AriaNeural",
};

export interface AzureSpeechConfig {
  key: string;
  region: string;
  locale: SpeechLocale;
  voice?: string;
}

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  confidence?: number;
  error?: string;
}

export interface SynthesizeResult {
  ok: boolean;
  audio?: ArrayBuffer;
  mime?: string;
  error?: string;
}

export function isSpeechLocale(v: unknown): v is SpeechLocale {
  return v === "pl-PL" || v === "en-US";
}

export function sttEndpoint(region: string, locale: SpeechLocale): string {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`;
}

export function ttsEndpoint(region: string): string {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSsml(text: string, voice: string, locale: SpeechLocale): string {
  return `<speak version="1.0" xml:lang="${locale}"><voice name="${voice}">${xmlEscape(text)}</voice></speak>`;
}

export async function resolveAzureSpeechConfig(
  getSecret: (label: string) => Promise<string | null>,
  locale: SpeechLocale,
): Promise<AzureSpeechConfig | null> {
  const key = (await getSecret(AZURE_SPEECH_KEY_LABEL))?.trim();
  if (!key) return null;
  const region =
    (await getSecret(AZURE_SPEECH_REGION_LABEL))?.trim() || DEFAULT_AZURE_REGION;
  return {
    key,
    region,
    locale,
    voice: DEFAULT_VOICE_BY_LOCALE[locale],
  };
}

export async function transcribeWav(
  wav: ArrayBuffer,
  cfg: AzureSpeechConfig,
  deps?: { fetchImpl?: typeof fetch },
): Promise<TranscribeResult> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(sttEndpoint(cfg.region, cfg.locale), {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        Accept: "application/json",
      },
      body: wav,
    });
    if (!res.ok) {
      return { ok: false, error: `azure_stt_${res.status}` };
    }
    const json = (await res.json()) as {
      RecognitionStatus?: string;
      DisplayText?: string;
      NBest?: Array<{ Display?: string; Confidence?: number }>;
    };
    const status = json.RecognitionStatus;
    if (status === "NoMatch" || status === "InitialSilenceTimeout") {
      return { ok: false, error: "no_speech" };
    }
    if (status !== "Success") {
      return { ok: false, error: `azure_stt_status_${status ?? "unknown"}` };
    }
    const n0 = json.NBest?.[0];
    const text = n0?.Display ?? json.DisplayText;
    if (!text) return { ok: false, error: "no_speech" };
    return {
      ok: true,
      text,
      confidence: typeof n0?.Confidence === "number" ? n0.Confidence : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "azure_stt_error";
    return { ok: false, error: msg.includes(cfg.key) ? "azure_stt_error" : msg };
  }
}

export async function synthesizeSpeech(
  text: string,
  cfg: AzureSpeechConfig,
  deps?: { fetchImpl?: typeof fetch },
): Promise<SynthesizeResult> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const voice = cfg.voice ?? DEFAULT_VOICE_BY_LOCALE[cfg.locale];
  try {
    const res = await fetchImpl(ttsEndpoint(cfg.region), {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "combo-x-jarvis",
      },
      body: buildSsml(text, voice, cfg.locale),
    });
    if (!res.ok) {
      return { ok: false, error: `azure_tts_${res.status}` };
    }
    const audio = await res.arrayBuffer();
    return { ok: true, audio, mime: "audio/mpeg" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "azure_tts_error";
    return { ok: false, error: msg.includes(cfg.key) ? "azure_tts_error" : msg };
  }
}
