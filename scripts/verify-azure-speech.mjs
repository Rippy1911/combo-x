#!/usr/bin/env node
/**
 * Live Azure Speech round-trip for Jarvis (combo-x).
 *
 * Mirrors packages/core/src/voice/azureSpeech.ts endpoints/headers/SSML,
 * but requests TTS as riff-16khz-16bit-mono-pcm so short-audio STT can
 * consume the bytes without transcoding (extension TTS uses mp3 for playback).
 *
 * Usage (from combo-x/):
 *   node scripts/verify-azure-speech.mjs
 *
 * Env (portfolio root ../../.env): AZURE_SPEECH_KEY, AZURE_SPEECH_REGION,
 * optional AZURE_SPEECH_ENDPOINT, AZURE_TTS_FIRST_BYTE_BUDGET_MS (default 800).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMBO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.resolve(__dirname, "../../.env");
const ARTIFACT_DIR = path.resolve(COMBO_ROOT, "../_artifacts/jarvis-azure-verify");

/** Same defaults as packages/core/src/voice/azureSpeech.ts */
const DEFAULT_VOICE_BY_LOCALE = {
  "pl-PL": "pl-PL-ZofiaNeural",
  "en-US": "en-US-AriaNeural",
};

const CASES = [
  {
    locale: "pl-PL",
    voice: DEFAULT_VOICE_BY_LOCALE["pl-PL"],
    phrase: "Cześć, jestem Jarvis. Słucham.",
    file: "pl-PL.wav",
  },
  {
    locale: "en-US",
    voice: DEFAULT_VOICE_BY_LOCALE["en-US"],
    phrase: "Hey, Jarvis here. Listening.",
    file: "en-US.wav",
  },
];

/** STT-compatible Neural TTS output (extension uses mp3 for playback). */
const TTS_OUTPUT_FORMAT = "riff-16khz-16bit-mono-pcm";
const MIN_AUDIO_BYTES = 1000;
const MIN_OVERLAP = 0.5;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function sttEndpoint(region, locale) {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`;
}

function ttsEndpoint(region) {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text, voice, locale) {
  return `<speak version="1.0" xml:lang="${locale}"><voice name="${voice}">${xmlEscape(text)}</voice></speak>`;
}

function isRiffWav(buf) {
  if (buf.byteLength < 12) return false;
  const u8 = new Uint8Array(buf);
  const ascii = (i, n) => String.fromCharCode(...u8.subarray(i, i + n));
  return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
}

function normalizeWords(s) {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function overlapScore(expected, actual) {
  const ew = normalizeWords(expected);
  const aw = new Set(normalizeWords(actual));
  if (ew.length === 0) return 0;
  let hit = 0;
  for (const w of ew) if (aw.has(w)) hit++;
  return hit / ew.length;
}

function redactSecrets(text, key) {
  if (!text) return text;
  let out = String(text);
  if (key && key.length >= 8) out = out.split(key).join("[REDACTED]");
  return out.slice(0, 800);
}

async function readBodyWithFirstByte(res, t0) {
  if (!res.body) {
    const ab = await res.arrayBuffer();
    return { firstByteMs: performance.now() - t0, buffer: Buffer.from(ab) };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let firstByteMs = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs == null) firstByteMs = performance.now() - t0;
    chunks.push(Buffer.from(value));
  }
  if (firstByteMs == null) firstByteMs = performance.now() - t0;
  return { firstByteMs, buffer: Buffer.concat(chunks) };
}

async function synthesizePcm(phrase, { key, region, locale, voice }) {
  const t0 = performance.now();
  const res = await fetch(ttsEndpoint(region), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": TTS_OUTPUT_FORMAT,
      "User-Agent": "combo-x-jarvis",
    },
    body: buildSsml(phrase, voice, locale),
  });
  const { firstByteMs, buffer } = await readBodyWithFirstByte(res, t0);
  let errBody = "";
  if (!res.ok) {
    errBody = redactSecrets(buffer.toString("utf8"), key);
  }
  return {
    status: res.status,
    ok: res.ok,
    firstByteMs: Math.round(firstByteMs),
    totalMs: Math.round(performance.now() - t0),
    buffer,
    errBody,
  };
}

async function recognizeWav(wav, { key, region, locale }) {
  const res = await fetch(sttEndpoint(region, locale), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: wav,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    return {
      status: res.status,
      ok: false,
      recognizedText: "",
      errBody: redactSecrets(text, key),
    };
  }
  const status = json?.RecognitionStatus;
  const n0 = json?.NBest?.[0];
  const recognizedText = n0?.Display ?? json?.DisplayText ?? "";
  const ok = status === "Success" && Boolean(recognizedText);
  return {
    status: res.status,
    ok,
    recognitionStatus: status,
    recognizedText,
    errBody: ok ? "" : redactSecrets(JSON.stringify(json ?? text), key),
  };
}

async function main() {
  const fileEnv = loadEnvFile(ENV_PATH);
  const key = (process.env.AZURE_SPEECH_KEY || fileEnv.AZURE_SPEECH_KEY || "").trim();
  const region = (
    process.env.AZURE_SPEECH_REGION ||
    fileEnv.AZURE_SPEECH_REGION ||
    ""
  ).trim();
  const endpoint = (
    process.env.AZURE_SPEECH_ENDPOINT ||
    fileEnv.AZURE_SPEECH_ENDPOINT ||
    ""
  ).trim();
  const budgetMs = Number(
    process.env.AZURE_TTS_FIRST_BYTE_BUDGET_MS ||
      fileEnv.AZURE_TTS_FIRST_BYTE_BUDGET_MS ||
      800,
  );

  if (!key || !region) {
    console.error(
      "Missing AZURE_SPEECH_KEY and/or AZURE_SPEECH_REGION.\n" +
        `Load them in ${ENV_PATH} (names only; never commit values).`,
    );
    process.exit(2);
  }

  console.log("Azure Speech verify (Jarvis round-trip)");
  console.log(`  env file: ${ENV_PATH}`);
  console.log(`  region:   ${region}`);
  console.log(`  endpoint: ${endpoint ? "(set, unused — using region hosts like azureSpeech.ts)" : "(not set)"}`);
  console.log(`  TTS fmt:  ${TTS_OUTPUT_FORMAT}`);
  console.log(`  TTFB budget: ${budgetMs} ms (report-only)`);
  console.log(`  artifacts: ${ARTIFACT_DIR}`);
  console.log("");

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const results = [];
  let allPass = true;

  for (const c of CASES) {
    console.log(`── ${c.locale} / ${c.voice} ──`);
    console.log(`  phrase: ${c.phrase}`);

    let row = {
      voice: c.voice,
      locale: c.locale,
      phrase: c.phrase,
      ttsStatus: 0,
      ttsBytes: 0,
      ttsFirstByteMs: null,
      ttsBudgetMs: budgetMs,
      ttsBudgetMet: null,
      sttStatus: 0,
      recognizedText: "",
      overlapScore: 0,
      pass: false,
      error: null,
    };

    try {
      const tts = await synthesizePcm(c.phrase, {
        key,
        region,
        locale: c.locale,
        voice: c.voice,
      });
      row.ttsStatus = tts.status;
      row.ttsBytes = tts.buffer.byteLength;
      row.ttsFirstByteMs = tts.firstByteMs;
      row.ttsBudgetMet = tts.firstByteMs <= budgetMs;

      console.log(
        `  TTS: HTTP ${tts.status}, ${tts.buffer.byteLength} bytes, first-byte ${tts.firstByteMs} ms` +
          ` (budget ${budgetMs} ms: ${row.ttsBudgetMet ? "MET" : "MISS"})`,
      );

      if (!tts.ok) {
        row.error = `tts_http_${tts.status}: ${tts.errBody}`;
        allPass = false;
        console.log(`  FAIL TTS: ${row.error}`);
        results.push(row);
        continue;
      }
      if (tts.buffer.byteLength < MIN_AUDIO_BYTES) {
        row.error = `tts_too_small_${tts.buffer.byteLength}`;
        allPass = false;
        console.log(`  FAIL TTS: audio too small`);
        results.push(row);
        continue;
      }
      if (!isRiffWav(tts.buffer)) {
        row.error = "tts_not_riff_wav";
        allPass = false;
        console.log(`  FAIL TTS: missing RIFF/WAVE header`);
        results.push(row);
        continue;
      }

      const wavPath = path.join(ARTIFACT_DIR, c.file);
      fs.writeFileSync(wavPath, tts.buffer);
      console.log(`  wrote ${wavPath}`);

      const stt = await recognizeWav(tts.buffer, {
        key,
        region,
        locale: c.locale,
      });
      row.sttStatus = stt.status;
      row.recognizedText = stt.recognizedText || "";
      row.overlapScore = Number(
        overlapScore(c.phrase, row.recognizedText).toFixed(3),
      );

      console.log(
        `  STT: HTTP ${stt.status}, status=${stt.recognitionStatus ?? "?"}, text=${JSON.stringify(row.recognizedText)}`,
      );
      console.log(`  overlap: ${row.overlapScore} (need ≥ ${MIN_OVERLAP})`);

      if (!stt.ok) {
        row.error = `stt_fail: ${stt.errBody || stt.recognitionStatus}`;
        allPass = false;
        console.log(`  FAIL STT`);
        results.push(row);
        continue;
      }
      if (row.overlapScore < MIN_OVERLAP) {
        row.error = `overlap_${row.overlapScore}`;
        allPass = false;
        console.log(`  FAIL overlap`);
        results.push(row);
        continue;
      }

      row.pass = true;
      console.log(`  PASS`);
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
      if (key && row.error.includes(key)) row.error = "network_or_runtime_error";
      allPass = false;
      console.log(`  FAIL exception: ${row.error}`);
    }
    results.push(row);
    console.log("");
  }

  const summary = {
    at: new Date().toISOString(),
    region,
    endpointConfigured: Boolean(endpoint),
    ttsOutputFormat: TTS_OUTPUT_FORMAT,
    ttsFirstByteBudgetMs: budgetMs,
    locales: Object.fromEntries(results.map((r) => [r.locale, r])),
    allPass,
  };
  const resultPath = path.join(ARTIFACT_DIR, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`wrote ${resultPath}`);
  console.log("");
  console.log("══ SUMMARY ══");
  for (const r of results) {
    console.log(
      `  ${r.locale}: ${r.pass ? "PASS" : "FAIL"}` +
        ` | TTFB ${r.ttsFirstByteMs ?? "?"}ms` +
        ` | overlap ${r.overlapScore}` +
        ` | recognized=${JSON.stringify(r.recognizedText)}` +
        (r.error ? ` | error=${r.error}` : ""),
    );
  }
  console.log(allPass ? "\nOVERALL: PASS" : "\nOVERALL: FAIL");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
