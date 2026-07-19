import type { RestConnector } from "./store.js";

/** GitHub REST API connector template (token via vault — no secrets embedded). */
export function githubRestTemplate(opts?: {
  vaultLabel?: string;
  id?: string;
  name?: string;
}): RestConnector {
  const vaultLabel = opts?.vaultLabel?.trim() || "github_token";
  return {
    id: opts?.id?.trim() || "github-rest",
    kind: "rest",
    name: opts?.name?.trim() || "GitHub REST",
    baseUrl: "https://api.github.com",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: { vaultLabel },
    },
    tools: [
      {
        name: "search_code",
        method: "GET",
        path: "/search/code",
        description: "Search code in repositories",
      },
      {
        name: "get_contents",
        method: "GET",
        path: "/repos/{owner}/{repo}/contents/{path}",
        description: "Read a file from a repository",
      },
    ],
  };
}

/**
 * ns-fc-uploads protected tier (Bearer fcu_* in vault label `fc_uploads_key`).
 * Prefer tool `publish_upload` for multipart; this connector is for list/admin JSON calls.
 */
export function uploadsRestTemplate(): RestConnector {
  return {
    id: "ns-uploads",
    kind: "rest",
    name: "NS Uploads",
    baseUrl: "https://uploads.nextsolutions.studio",
    headers: {
      Authorization: { vaultLabel: "fc_uploads_key" },
      Accept: "application/json",
    },
    tools: [
      {
        name: "list",
        method: "GET",
        path: "/list",
        description: "List recent uploads (query workspace_id, limit)",
      },
      {
        name: "openapi",
        method: "GET",
        path: "/openapi.json",
        description: "OpenAPI document",
      },
    ],
  };
}

/** ns-food nutrition API (Bearer nsk_* in vault label `ns_food_key`). */
export function nsFoodRestTemplate(): RestConnector {
  return {
    id: "ns-food",
    kind: "rest",
    name: "NS Food",
    baseUrl: "https://food.nextsolutions.studio",
    headers: {
      Authorization: { vaultLabel: "ns_food_key" },
      Accept: "application/json",
    },
    tools: [
      {
        name: "search",
        method: "GET",
        path: "/v1/search",
        description: "Search foods ?q=&locale=&page_size=",
      },
      {
        name: "product",
        method: "GET",
        path: "/v1/product/{barcode}",
        description: "Lookup by EAN/UPC barcode",
      },
      {
        name: "autocomplete",
        method: "GET",
        path: "/v1/autocomplete",
        description: "Prefix autocomplete ?q=&locale=",
      },
    ],
  };
}
