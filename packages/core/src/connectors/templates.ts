import type { RestConnector } from "./store.js";

/** GitHub REST API connector template (token via vault — no secrets embedded). */
export function githubRestTemplate(): RestConnector {
  return {
    id: "github-rest",
    kind: "rest",
    name: "GitHub REST",
    baseUrl: "https://api.github.com",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: { vaultLabel: "github_token" },
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
