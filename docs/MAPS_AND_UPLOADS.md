# Maps + Uploads

Local-first map reports and shareable CDN links (v1.6.16+).

## Tools

| Tool | Purpose |
|------|---------|
| `create_map_report` | Build MapLibre HTML (OpenFreeMap PL/EN) from `{lat,lng,label?,note?}[]` → preview + local report |
| `publish_upload` | Multipart upload to `uploads.nextsolutions.studio` → public `file_url` |

Skills (playbooks): `combo-map`, `combo-uploads`, `combo-ns-food`.

## Map flow

1. Gather markers (scrape / user / geocode).
2. `create_map_report({ title, markers, locale: "pl"|"en" })`.
3. `publish_upload({ filename: "map.html", reportId })` → open shareable HTTPS URL.

Style JSON is **inlined** when fetchable from the portfolio CDN so the page works from uploads (no chrome-extension CORS). Vector tiles still load from OpenFreeMap (`CORS *`).

Style URLs:

- PL: `https://assets.nextsolutions.studio/vendor/openfreemap/styles/liberty_pl.json`
- EN: `https://assets.nextsolutions.studio/vendor/openfreemap/styles/liberty_en.json`

## Uploads

- **Public** (default): `POST /upload` — no API key; headers `X-FC-Workspace-Id` / `X-FC-App-Name` default `combo-x`.
- **Protected**: Settings → Connectors → **NS Uploads** template + vault `fc_uploads_key` (`fcu_*`) → `publish_upload({ connectorId: "ns-uploads", … })`.

Do not upload secrets on the public tier (world-readable `/f/…`).

## NS Food (bonus)

Settings → **NS Food** template + vault `ns_food_key` → `rest_request` on `/v1/search`, `/v1/product/{ean}`, `/v1/autocomplete`. See skill `combo-ns-food`.
