# Connectors (REST + remote MCP)

User-configured integrations — **no hardcoded product hosts**.

## REST

Settings → Connectors → Add REST, or templates:

| Template | Connector id | Vault label | Notes |
|----------|--------------|-------------|-------|
| GitHub | `github-rest` | `github_token` | Requires token before add |
| NS Uploads | `ns-uploads` | `fc_uploads_key` | Protected `/v2`; public uploads use tool `publish_upload` (no key) |
| NS Food | `ns-food` | `ns_food_key` | `nsk_*` Bearer for search/barcode |

Agent tool: `rest_request { connectorId, method, path, query?, body? }`.

Headers may use `{ vaultLabel: "conn:…" }` secret refs resolved from the vault at call time.

Maps + CDN publish: [`MAPS_AND_UPLOADS.md`](./MAPS_AND_UPLOADS.md) (`create_map_report`, `publish_upload`).

## MCP (remote HTTP)

Paste an MCP / mcp.json-style definition → Combo-X runs `parseMcpDefinition`:
1. Detects secret-like values
2. Suggests vault labels
3. You confirm → secrets go to vault; connector stores sanitized def with `{vault:label}` placeholders

Tools: `mcp_list_tools`, `mcp_call` (HTTP JSON-RPC). SSE/stdio local companions are out of scope.

## Agent access

Each agent profile has `connectorIds[]`. Runs only allow those connectors (empty = all configured).
