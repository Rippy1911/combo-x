import { describe, expect, it } from "vitest";
// Single source of truth for the Chrome→Firefox manifest transform.
import { toFirefoxManifest } from "../../../../scripts/firefox-manifest.mjs";

const chromeManifest = {
  manifest_version: 3,
  name: "Combo-X",
  version: "1.4.3",
  icons: { "16": "public/icon-16.png", "128": "public/icon-128.png" },
  background: { service_worker: "service-worker-loader.js", type: "module" },
  side_panel: { default_path: "src/sidepanel/index.html" },
  permissions: [
    "sidePanel",
    "storage",
    "scripting",
    "tabs",
    "offscreen",
    "tabCapture",
    "downloads",
  ],
  host_permissions: ["<all_urls>"],
  web_accessible_resources: [
    {
      matches: ["<all_urls>"],
      resources: ["setup/index.html", "assets/*", "src/offscreen/offscreen.html"],
      use_dynamic_url: true,
    },
  ],
};

describe("toFirefoxManifest", () => {
  const ff = toFirefoxManifest(chromeManifest);

  it("uses background.scripts instead of service_worker", () => {
    expect(ff.background).toEqual({ scripts: ["service-worker-loader.js"], type: "module" });
    expect("service_worker" in ff.background).toBe(false);
  });

  it("replaces side_panel with sidebar_action", () => {
    expect(ff.side_panel).toBeUndefined();
    expect(ff.sidebar_action.default_panel).toBe("src/sidepanel/index.html");
    expect(ff.sidebar_action.default_icon).toEqual(chromeManifest.icons);
  });

  it("drops Chromium-only permissions", () => {
    expect(ff.permissions).not.toContain("sidePanel");
    expect(ff.permissions).not.toContain("offscreen");
    expect(ff.permissions).not.toContain("tabCapture");
    expect(ff.permissions).toContain("storage");
    expect(ff.permissions).toContain("scripting");
  });

  it("adds gecko settings with data_collection_permissions", () => {
    expect(ff.browser_specific_settings.gecko.id).toBe("combo-x@local.first");
    expect(ff.browser_specific_settings.gecko.data_collection_permissions).toEqual({
      required: ["none"],
    });
  });

  it("strips offscreen and use_dynamic_url from web_accessible_resources", () => {
    const entry = ff.web_accessible_resources[0] as {
      resources: string[];
      use_dynamic_url?: boolean;
    };
    expect(entry.resources).not.toContain("src/offscreen/offscreen.html");
    expect(entry.resources).toContain("assets/*");
    expect(entry.use_dynamic_url).toBeUndefined();
  });

  it("registers _execute_sidebar_action command", () => {
    const commands = ff.commands as Record<string, { description?: string }> | undefined;
    expect(commands?._execute_sidebar_action?.description).toMatch(/sidebar/i);
  });

  it("does not mutate the input manifest", () => {
    expect(chromeManifest.side_panel).toBeDefined();
    expect(chromeManifest.permissions).toContain("sidePanel");
  });
});
