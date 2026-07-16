# Page extensions (browser userscripts)

**Shipped in v1.2** — MAIN-world inject, isolated IDB, agent-only bridge, full audit.

## Isolation model

```mermaid
flowchart TB
  subgraph page [Page MAIN world]
    Script[PageExtension_source]
    ComboXAPI[ComboX_export_storage_log]
    Script --> ComboXAPI
  end

  subgraph isolated [Combo content ISOLATED]
    Listener[postMessage_listener]
  end

  subgraph host [Service worker / sidepanel]
    Store[(combo_x_page_ext)]
    ComboDB[(sessions_vault_views)]
    Agent[AgentLoop_tools]
  end

  ComboXAPI -->|window.postMessage| Listener
  Listener -->|page_ext_bridge only| Store
  Agent -->|CRUD_inject_bridge| Store
  Listener -.->|NO access| ComboDB
  Script -.->|NO chrome.*| ComboDB
```

| Rule | Enforcement |
|------|-------------|
| No `chrome.*` in user scripts | Inject with `world: "MAIN"` only |
| No Combo sessions/vault/views | Separate DB `combo_x_page_ext` |
| No programmatic Combo control | Content script ignores non-bridge envelopes; SW never maps bridge → RuntimeMessage tools |
| Data out only via agent bridge | `bridge` null by default; `set_page_extension_bridge` required |

## Lifecycle

1. `create_page_extension` → **draft**, disabled  
2. Edit in **Page ext** tab or `update_page_extension`  
3. `approve_page_extension` (sensitive)  
4. `update_page_extension` `{ enabled: true }`  
5. Optional: `set_page_extension_bridge` `{ exportChannels, allowStorage }`  
6. `inject_page_extension` or auto-inject on `tabs.onUpdated` complete  

Source change → approval resets to **draft**.

## ComboX API (inside source)

```js
ComboX.id          // extension id
ComboX.name
ComboX.export(channel, payload)   // requires bridge.exportChannels
ComboX.storage.get/set/delete/list // requires bridge.allowStorage
ComboX.log(msg)                   // audit only
```

Exports land in isolated data under `export:<channel>`. Agent reads with `page_ext_data_get`.

## Traceability

- Per-extension audit store (`create` / `approve` / `inject` / `export` / `storage_*` / …)
- `sourceHash` (SHA-256) on create/approve
- ActionLog redacts full `source` for create/update tools
- UI: Page ext → Audit list

## Tools

`create_page_extension`, `update_page_extension`, `list_page_extensions`, `get_page_extension`, `approve_page_extension`, `revoke_page_extension`, `inject_page_extension`, `set_page_extension_bridge`, `page_ext_data_*`, `list_page_extension_audit`

## Example use-cases

| Idea | Patterns | Bridge |
|------|----------|--------|
| Allegro viewed products | `https://allegro.pl/*` | storage + `exportChannels: ["viewed"]` |
| Third-party page enhancer | site origin glob | optional export |
| Game bot helpers | game origin | usually no bridge |
| Password helper UI | login origins | **prefer Combo Vault + login tool** — do not put master secrets in page scripts |

## Files

- `packages/core/src/pageExtensions/*`
- `extension/src/lib/page-ext-inject.ts`
- `extension/src/content/content.ts` (bridge listener)
- `extension/src/sidepanel/PageExtensionsPanel.tsx`
