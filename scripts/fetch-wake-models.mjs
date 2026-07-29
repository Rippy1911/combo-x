#!/usr/bin/env node
/**
 * Fetch openWakeWord ONNX models for the Jarvis wake word into
 * extension/public/openwakeword/ (gitignored).
 *
 * The models are CC BY-NC-SA 4.0 (NON-COMMERCIAL) while openWakeWord's code is
 * Apache-2.0. They are therefore never committed and only bundled when
 * JARVIS_DEV_BUILD=1. See docs/JARVIS.md before shipping commercially.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1";
const FILES = ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"];
const LICENSE_NOTE = `openWakeWord pretrained models — CC BY-NC-SA 4.0 (non-commercial).
Source: ${RELEASE}
Code upstream is Apache-2.0; these model weights are not. Do not ship them in a
commercial build: train a custom model or licence a commercial wake word instead.
`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "extension/public/openwakeword");

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const file of FILES) {
    const url = `${RELEASE}/${file}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 1024) throw new Error(`${file}: suspiciously small (${bytes.byteLength}B)`);
    await writeFile(path.join(outDir, file), bytes);
    console.log(`ok  ${file}  ${(bytes.byteLength / 1024).toFixed(0)} KiB`);
  }
  await writeFile(path.join(outDir, "LICENSE-NOTICE.txt"), LICENSE_NOTE);
  console.log(`\nmodels in ${outDir}\nbuild with JARVIS_DEV_BUILD=1 to bundle them`);
}

main().catch((err) => {
  console.error(`fetch-wake-models failed: ${err.message}`);
  process.exit(1);
});
