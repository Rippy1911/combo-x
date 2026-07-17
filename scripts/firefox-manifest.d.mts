interface WebAccessibleResource {
  matches: string[];
  resources: string[];
}

export interface FirefoxManifest {
  background: { scripts: string[]; type?: string };
  side_panel?: unknown;
  sidebar_action: { default_title: string; default_panel: string; default_icon: unknown };
  permissions: string[];
  browser_specific_settings: {
    gecko: {
      id: string;
      strict_min_version: string;
      data_collection_permissions: { required: string[] };
    };
  };
  web_accessible_resources: WebAccessibleResource[];
  [key: string]: unknown;
}

export function toFirefoxManifest(chromeManifest: Record<string, unknown>): FirefoxManifest;
