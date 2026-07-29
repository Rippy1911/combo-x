import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * openWakeWord pretrained models are CC BY-NC-SA 4.0. They must never enter git and must
 * only reach a bundle when JARVIS_DEV_BUILD=1, so a default build stays distributable.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("Combo voice wake asset licensing", () => {
  it("keeps the model directory out of git", () => {
    const ignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    expect(ignore).toContain("extension/public/openwakeword/");
  });

  it("only bundles models behind JARVIS_DEV_BUILD", () => {
    const config = readFileSync(path.join(repoRoot, "extension/vite.config.ts"), "utf8");
    expect(config).toContain('process.env.JARVIS_DEV_BUILD === "1"');
    const copyBlock = config.slice(config.indexOf("function copyComboVoiceAssetsPlugin"));
    const modelCopy = copyBlock.indexOf("WAKE_MODEL_FILES");
    const devGuard = copyBlock.indexOf("if (!devBuild) return;");
    expect(devGuard).toBeGreaterThan(-1);
    expect(devGuard).toBeLessThan(modelCopy);
  });

  it("ships a licence notice alongside any fetched model", () => {
    const script = readFileSync(path.join(repoRoot, "scripts/fetch-wake-models.mjs"), "utf8");
    expect(script).toContain("CC BY-NC-SA 4.0");
    expect(script).toContain("LICENSE-NOTICE.txt");
  });

  it("has no committed model weights", () => {
    const modelDir = path.join(repoRoot, "extension/public/openwakeword");
    if (!existsSync(modelDir)) return;
    const tracked = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    expect(tracked).toContain("extension/public/openwakeword/");
  });
});
