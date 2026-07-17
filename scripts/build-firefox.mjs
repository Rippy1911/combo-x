#!/usr/bin/env node
/**
 * Firefox build post-processor.
 *
 * The Chrome build (CRXJS) emits `extension/dist` with a Chromium-only manifest
 * (service_worker background, side_panel, offscreen/tabCapture/sidePanel perms).
 * Firefox MV3 differs, so we clone the built output into `extension/dist-firefox`
 * and rewrite ONLY the manifest — all hashed asset paths are preserved.
 *
 * Run AFTER `pnpm --filter @combo-x/extension build`.
 *
 * Known runtime caveats (documented in docs/FIREFOX.md):
 *  - Media capture (screenshots/recording) is unavailable: it relies on
 *    chrome.offscreen + chrome.tabCapture, which Firefox lacks. The code now
 *    degrades gracefully and returns a clear error for those tools.
 *  - The UI is served via sidebar_action instead of chrome.sidePanel.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toFirefoxManifest } from "./firefox-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(__dirname, "../extension");
const distDir = path.join(extDir, "dist");
const outDir = path.join(extDir, "dist-firefox");

if (!existsSync(path.join(distDir, "manifest.json"))) {
  console.error("[build:firefox] extension/dist/manifest.json not found — run the extension build first.");
  process.exit(1);
}

// 1. Clone the Chrome build.
rmSync(outDir, { recursive: true, force: true });
cpSync(distDir, outDir, { recursive: true });

// 2. Transform the manifest (single source of truth in firefox-manifest.mjs).
const chromeManifest = JSON.parse(readFileSync(path.join(distDir, "manifest.json"), "utf8"));
const firefoxManifest = toFirefoxManifest(chromeManifest);

writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(firefoxManifest, null, 2));

console.log(`[build:firefox] wrote ${path.relative(extDir, outDir)}/manifest.json`);
console.log("[build:firefox] load via about:debugging → This Firefox → Load Temporary Add-on → dist-firefox/manifest.json");
console.log("[build:firefox] or package with: npx web-ext build --source-dir extension/dist-firefox");
