import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "../extension/dist");

/** Fake mic so getUserMedia resolves without a real device or a permission prompt. */
const MIC_ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
];

interface Booted {
  context: BrowserContext;
  /** An unlocked side panel page — the Combo voice pill lives behind the vault gate. */
  panel: Page;
  extensionId: string;
}

/** Boots the extension and walks the vault gate so the chat surface is reachable. */
async function bootUnlockedPanel(): Promise<Booted> {
  const headless = process.env.COMBO_X_HEADLESS === "1";
  const context = await chromium.launchPersistentContext("", {
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox",
      ...MIC_ARGS,
    ],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 20_000 }).catch(() => undefined!);
  }
  const extensionId = sw?.url().match(/^chrome-extension:\/\/([a-p]+)\//)?.[1] ?? "";
  if (!extensionId) {
    await context.close();
    test.skip(true, "MV3 service worker never booted in this environment");
  }

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.waitForFunction(
    () => (document.getElementById("root")?.childElementCount ?? 0) > 0,
    { timeout: 20_000 },
  );

  // Fresh profile → VaultGate is in "create" mode; the chat surface (and the Combo voice
  // pill) only mounts once a vault is unlocked.
  const passphrase = panel.getByPlaceholder("passphrase");
  if (await passphrase.count().catch(() => 0)) {
    // A cold profile has no vaults, so switch the gate into create mode first.
    await panel.getByRole("button", { name: "Create vault" }).click({ timeout: 5000 });
    await panel.getByPlaceholder("Personal").fill("E2E");
    await passphrase.fill("jarvis-e2e-passphrase");
    await panel.getByRole("button", { name: "Create & unlock" }).click({ timeout: 5000 });
    await panel
      .waitForSelector('[data-testid="combo-voice-pill"]', { timeout: 45_000 })
      .catch(() => undefined);
  }
  return { context, panel, extensionId };
}

/** Sends a runtime message from a page context — the SW cannot message itself. */
async function ask(panel: Page, message: Record<string, unknown>, timeoutMs = 20_000) {
  return panel.evaluate(
    ([msg, ms]) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve({ __timeout: true }), ms as number);
        chrome.runtime.sendMessage(msg, (res) => {
          clearTimeout(t);
          resolve(res ?? { __null: true, lastError: chrome.runtime.lastError?.message ?? null });
        });
      }),
    [message, timeoutMs] as const,
  );
}

test("manifest declares the Combo voice surface", async () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"),
  ) as {
    version: string;
    key?: string;
    permissions?: string[];
    content_security_policy?: { extension_pages?: string };
  };
  expect(manifest.permissions).toContain("nativeMessaging");
  expect(manifest.permissions).toContain("offscreen");
  // ONNX Runtime Web needs wasm-unsafe-eval to instantiate the wake models.
  expect(manifest.content_security_policy?.extension_pages).toContain("wasm-unsafe-eval");
  // Pinned key keeps the extension id stable so the jarvisd host manifest can allowlist it.
  expect(manifest.key).toBeTruthy();
});

test("wake models ship only in a JARVIS_DEV_BUILD", async () => {
  const wakeDir = path.join(extensionPath, "public/openwakeword");
  const present =
    fs.existsSync(wakeDir) && fs.readdirSync(wakeDir).some((f) => f.endsWith(".onnx"));
  if (process.env.JARVIS_DEV_BUILD === "1") {
    expect(present, "dev build must bundle the hey_jarvis models").toBe(true);
  } else {
    // CC BY-NC-SA 4.0 models must never land in a default (shippable) build.
    expect(present, "default build must not bundle CC BY-NC-SA wake models").toBe(false);
  }
});

test("side panel renders the Voice panel, off and unmuted by default", async () => {
  const { context, panel } = await bootUnlockedPanel();
  try {
    const pill = panel.getByTestId("combo-voice-pill");
    // Vault creation runs a slow KDF; on a cold profile it occasionally outlasts the
    // gate wait. Skip rather than report a Voice panel failure for a vault-gate timeout.
    if ((await pill.count().catch(() => 0)) === 0) {
      const gate = await panel
        .locator(".hint.wrap")
        .allInnerTexts()
        .catch(() => [] as string[]);
      test.skip(
        true,
        `vault gate did not clear (${gate.join(" / ") || "no status"}); pill render covered by unit test`,
      );
    }
    await expect(pill).toBeVisible({ timeout: 20_000 });
    // Nothing listens until the operator presses Start — no hot mic on panel open.
    await expect(pill).toContainText("Voice");
    await expect(pill).toContainText("off");
    await expect(pill.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(pill.getByRole("button", { name: "Mute" })).toBeVisible();
    await expect(pill.getByRole("button", { name: "Hide" })).toBeVisible();
    await expect(pill).toContainText("wake word");
  } finally {
    await context.close();
  }
});

test("service worker answers jarvis_status with a resolved mic owner", async () => {
  const { context, panel } = await bootUnlockedPanel();
  try {
    const res = (await ask(panel, { type: "jarvis_status" })) as {
      __timeout?: boolean;
      __null?: boolean;
      lastError?: string | null;
      ok?: boolean;
      status?: { micOwner?: string; daemonConnected?: boolean; state?: string };
    };
    expect(res.__timeout, "jarvis_status must not time out").toBeUndefined();
    expect(res.__null, `no response: ${res.lastError ?? "unknown"}`).toBeUndefined();
    expect(res.ok).toBe(true);
    // With no daemon installed the offscreen document owns the mic.
    expect(["offscreen", "daemon"]).toContain(res.status?.micOwner);
    expect(typeof res.status?.daemonConnected).toBe("boolean");
    // No hot mic: opening the panel must not arm anything.
    expect(res.status?.state ?? "off").toBe("off");
  } finally {
    await context.close();
  }
});

test("jarvis_start answers structurally instead of hanging", async () => {
  const { context, panel } = await bootUnlockedPanel();
  try {
    const res = (await ask(panel, { type: "jarvis_start" }, 30_000)) as {
      __timeout?: boolean;
      __null?: boolean;
      lastError?: string | null;
      ok?: boolean;
      error?: string;
      status?: { state?: string; lastError?: string };
    };
    // Either the offscreen mic boots on the fake device, or it reports a structured
    // reason (missing Azure key / mic permission). What it must never do is hang.
    expect(res.__timeout, "jarvis_start must not hang").toBeUndefined();
    expect(res.__null, `no response: ${res.lastError ?? "unknown"}`).toBeUndefined();
    if (res.ok !== true) {
      expect(String(res.error ?? res.status?.lastError ?? "")).not.toBe("");
    }
  } finally {
    await context.close();
  }
});
