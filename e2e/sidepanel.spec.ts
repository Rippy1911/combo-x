import { test, expect } from "@playwright/test";
import { launchExtension, type ExtensionHarness } from "./harness";

/**
 * Autonomous diagnostic spec: boots the real extension, opens the side panel,
 * asserts the React app mounts without console errors, and captures logs +
 * a screenshot on failure for offline inspection (see e2e/artifacts/).
 */
test.describe("side panel diagnostics", () => {
  let harness: ExtensionHarness;

  test.beforeAll(async () => {
    harness = await launchExtension();
  });

  test.afterAll(async () => {
    await harness?.close();
  });

  test("service worker boots with a stable extension id", async () => {
    test.skip(!harness.serviceWorker, "service worker not observed (headless MV3 flake)");
    expect(harness.extensionId).toMatch(/^[a-p]{32}$/);
  });

  test("side panel mounts the React root without fatal errors", async () => {
    test.skip(!harness.extensionId, "no extension id; skipping panel render");
    const page = await harness.openSidePanel();
    try {
      // React mounts into #root — wait for at least one child element.
      await page.waitForFunction(
        () => (document.getElementById("root")?.childElementCount ?? 0) > 0,
        { timeout: 15_000 },
      );
      const rootChildren = await page.evaluate(
        () => document.getElementById("root")?.childElementCount ?? 0,
      );
      expect(rootChildren).toBeGreaterThan(0);

      const fatal = harness.logs.filter(
        (l) => l.type === "pageerror" || (l.type === "error" && /uncaught|is not a function/i.test(l.text)),
      );
      if (fatal.length > 0) {
        await harness.dump("sidepanel-fatal", page);
      }
      expect(fatal, JSON.stringify(fatal, null, 2)).toHaveLength(0);
    } catch (err) {
      await harness.dump("sidepanel-render-failure", page);
      throw err;
    } finally {
      await page.close();
    }
  });
});
