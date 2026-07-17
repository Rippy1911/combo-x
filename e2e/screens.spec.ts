import { test } from "@playwright/test";
import { launchExtension, type ExtensionHarness } from "./harness";

/**
 * Capture screenshots of the side panel across tabs for docs / review.
 * Output lands in e2e/artifacts/screens-*.png.
 */
test("capture side panel screens", async () => {
  const harness: ExtensionHarness = await launchExtension();
  test.skip(!harness.extensionId, "no extension id; service worker did not boot");
  const page = await harness.openSidePanel();
  try {
    // Give the React app a moment to hydrate.
    await page.waitForFunction(
      () => (document.getElementById("root")?.childElementCount ?? 0) > 0,
      { timeout: 15_000 },
    );
    await page.setViewportSize({ width: 460, height: 900 });
    await page.waitForTimeout(600);
    await harness.dump("screens-initial", page);

    // Onboarding gate: fill passphrase + a dummy BYOK key, then Start.
    const passphrase = page.getByPlaceholder("passphrase");
    if (await passphrase.count().catch(() => 0)) {
      await passphrase.fill("test-passphrase-123");
      const keyField = page.getByPlaceholder(/sk-or-v1/i).first();
      if (await keyField.count().catch(() => 0)) {
        await keyField.fill("sk-or-v1-test-dummy-key-for-ui-capture-only");
      }
      const start = page.getByRole("button", { name: /^start$/i }).first();
      await start.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      await harness.dump("screens-unlocked", page);
    }

    // Try to visit each top tab by visible label if present.
    const tabLabels = ["Chat", "Sessions", "Libraries", "Activity", "Usage", "Tasks", "Settings"];
    for (const label of tabLabels) {
      const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
      if (await btn.count().catch(() => 0)) {
        await btn.click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        await page
          .screenshot({ path: `e2e/artifacts/screens-${label.toLowerCase()}.png`, fullPage: true })
          .catch(() => undefined);
      }
    }
  } finally {
    await harness.dump("screens-final", page);
    await page.close();
    await harness.close();
  }
});
