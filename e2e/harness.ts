import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, type Page, type Worker, chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the built unpacked extension. */
export const extensionPath = path.resolve(__dirname, "../extension/dist");

/** Where captured logs / screenshots land for autonomous inspection. */
export const artifactsDir = path.resolve(__dirname, "artifacts");

export interface CapturedLog {
  source: "page" | "worker";
  type: string;
  text: string;
  ts: number;
}

export interface ExtensionHarness {
  context: BrowserContext;
  /** MV3 service worker (may be undefined if it never booted). */
  serviceWorker?: Worker;
  /** Resolved chrome-extension:// id, e.g. "abcd...". */
  extensionId: string;
  /** All console / error output collected across pages + worker. */
  logs: CapturedLog[];
  /** Open the extension side panel as a normal page (bypasses the panel chrome). */
  openSidePanel(): Promise<Page>;
  /** Persist collected logs + a screenshot for later inspection. */
  dump(label: string, page?: Page): Promise<void>;
  close(): Promise<void>;
}

/**
 * Launches Chromium with the unpacked extension loaded and wires up log capture.
 * MV3 service workers are unreliable headless, so we launch headed by default;
 * override with COMBO_X_HEADLESS=1 for CI smoke runs.
 */
export async function launchExtension(): Promise<ExtensionHarness> {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error(
      `extension not built at ${extensionPath} — run \`pnpm --filter @combo-x/extension build\` first`,
    );
  }
  fs.mkdirSync(artifactsDir, { recursive: true });

  const headless = process.env.COMBO_X_HEADLESS === "1";
  const context = await chromium.launchPersistentContext("", {
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox",
    ],
  });

  const logs: CapturedLog[] = [];
  const attachPage = (page: Page) => {
    page.on("console", (msg) => {
      logs.push({ source: "page", type: msg.type(), text: msg.text(), ts: Date.now() });
    });
    page.on("pageerror", (err) => {
      logs.push({ source: "page", type: "pageerror", text: err.stack ?? err.message, ts: Date.now() });
    });
  };
  context.on("page", attachPage);
  context.pages().forEach(attachPage);

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context
      .waitForEvent("serviceworker", { timeout: 20_000 })
      .catch(() => undefined as unknown as Worker);
  }
  if (serviceWorker) {
    serviceWorker.on("console", (msg) => {
      logs.push({ source: "worker", type: msg.type(), text: msg.text(), ts: Date.now() });
    });
  }

  const swUrl = serviceWorker?.url() ?? "";
  const extensionId = swUrl.match(/^chrome-extension:\/\/([a-p]+)\//)?.[1] ?? "";

  const harness: ExtensionHarness = {
    context,
    serviceWorker,
    extensionId,
    logs,
    async openSidePanel() {
      if (!extensionId) throw new Error("no extension id — service worker never booted");
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
      await page.waitForLoadState("domcontentloaded");
      return page;
    },
    async dump(label, page) {
      const safe = label.replace(/[^a-z0-9-_]/gi, "_");
      fs.writeFileSync(
        path.join(artifactsDir, `${safe}.log.json`),
        JSON.stringify(logs, null, 2),
      );
      if (page) {
        await page
          .screenshot({ path: path.join(artifactsDir, `${safe}.png`), fullPage: true })
          .catch(() => undefined);
      }
    },
    async close() {
      await context.close();
    },
  };
  return harness;
}
