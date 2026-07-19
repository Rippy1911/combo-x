/**
 * Pure transform: Chrome (CRXJS) MV3 manifest → Firefox MV3 manifest.
 * Kept dependency-free so it can be unit-tested and reused by the build script.
 */

const DROP_PERMISSIONS = new Set(["sidePanel", "offscreen", "tabCapture"]);

/**
 * @param {Record<string, any>} chromeManifest parsed extension/dist/manifest.json
 * @returns {Record<string, any>} Firefox-compatible manifest
 */
export function toFirefoxManifest(chromeManifest) {
  const loader = chromeManifest.background?.service_worker ?? "service-worker-loader.js";

  const firefox = {
    ...chromeManifest,
    browser_specific_settings: {
      gecko: {
        id: "combo-x@local.first",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
    background: { scripts: [loader], type: "module" },
    permissions: (chromeManifest.permissions ?? []).filter((p) => !DROP_PERMISSIONS.has(p)),
    sidebar_action: {
      default_title: "Combo-X",
      default_panel: chromeManifest.side_panel?.default_path ?? "src/sidepanel/index.html",
      default_icon: chromeManifest.icons,
    },
  };
  delete firefox.side_panel;

  if (Array.isArray(firefox.web_accessible_resources)) {
    firefox.web_accessible_resources = firefox.web_accessible_resources.map((entry) => {
      const { use_dynamic_url: _drop, ...rest } = entry;
      return {
        ...rest,
        resources: (entry.resources ?? []).filter((r) => !r.includes("offscreen")),
      };
    });
  }

  // Built-in Firefox command: toggles this extension's sidebar (Zen/Firefox menu + shortcut).
  firefox.commands = {
    ...(firefox.commands && typeof firefox.commands === "object" ? firefox.commands : {}),
    _execute_sidebar_action: {
      description: "Toggle Combo-X sidebar",
    },
  };

  return firefox;
}
